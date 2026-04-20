import Foundation
import WhisperKit

// Modes
//   --check
//   --download <variant> <dest-root>
//   --audio <wav> --model-dir <dir> [--language <code>]    (batch)
//   --stream --model-dir <dir> [--language <code>]          (persistent streaming)
//
// Streaming protocol
//   stdin:  NDJSON commands
//           {"cmd":"start"[,"language":"ko"]}
//           {"cmd":"stop"}
//           {"cmd":"quit"}
//   stdout: NDJSON events
//           {"type":"ready"}
//           {"type":"partial","text":"..."}
//           {"type":"final","text":"..."}
//           {"type":"stopped"}
//           {"type":"error","message":"..."}

@main
struct TranscribeHelper {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())

        if args.first == "--check" {
            print("transcribe-helper ready")
            exit(0)
        }

        if args.first == "--download" {
            let variant = args[safe: 1] ?? "openai_whisper-small"
            let destRoot = args[safe: 2] ?? "models/whisperkit"
            await runDownload(variant: variant, destRoot: destRoot)
            return
        }

        if args.first == "--stream" {
            let modelDir = parseNamed(args, "--model-dir")
            let language = parseNamed(args, "--language") ?? "auto"
            guard let modelDir else {
                writeStderr("error: --model-dir <dir> is required\n")
                exit(2)
            }
            await runStream(modelDir: modelDir, language: language)
            return
        }

        await runBatch(args: args)
    }

    // MARK: - Download

    static func runDownload(variant: String, destRoot: String) async {
        do {
            let url = URL(fileURLWithPath: destRoot, isDirectory: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)

            writeStderr("downloading \(variant) → \(destRoot)/\(variant)/ ...\n")

            let path = try await WhisperKit.download(
                variant: variant,
                downloadBase: url,
                useBackgroundSession: false,
                from: "argmaxinc/whisperkit-coreml"
            )
            print(path.path)
        } catch {
            writeStderr("download failed: \(error)\n")
            exit(1)
        }
    }

    // MARK: - Batch (phase 1 fallback, unused by renderer when --stream is available)

    static func runBatch(args: [String]) async {
        guard let audioPath = parseNamed(args, "--audio") else {
            writeStderr("error: --audio <path> is required\n"); exit(2)
        }
        guard let modelDir = parseNamed(args, "--model-dir") else {
            writeStderr("error: --model-dir <dir> is required\n"); exit(2)
        }
        let language = parseNamed(args, "--language") ?? "auto"

        do {
            let whisperKit = try await WhisperKit(
                modelFolder: modelDir,
                verbose: false,
                logLevel: .none,
                load: true
            )

            let decodeOptions = DecodingOptions(
                language: language == "auto" ? nil : language,
                withoutTimestamps: true
            )

            let results = try await whisperKit.transcribe(
                audioPath: audioPath,
                decodeOptions: decodeOptions
            )

            let text = results
                .map { $0.text }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)

            print(text)
        } catch {
            writeStderr("error: \(error)\n")
            exit(1)
        }
    }

    // MARK: - Streaming

    actor StreamController {
        let whisperKit: WhisperKit
        var transcriber: AudioStreamTranscriber?
        var currentTask: Task<Void, Never>?
        var confirmedText: String = ""
        var hypothesisText: String = ""
        var streaming: Bool = false

        init(_ wk: WhisperKit) {
            self.whisperKit = wk
        }

        func start(language: String) async {
            guard !streaming else { return }

            confirmedText = ""
            hypothesisText = ""

            guard let tokenizer = whisperKit.tokenizer else {
                emit(["type": "error", "message": "tokenizer unavailable"])
                return
            }

            let decoding = DecodingOptions(
                task: .transcribe,
                language: language == "auto" ? nil : language,
                withoutTimestamps: true,
                wordTimestamps: false
            )

            let t = AudioStreamTranscriber(
                audioEncoder: whisperKit.audioEncoder,
                featureExtractor: whisperKit.featureExtractor,
                segmentSeeker: whisperKit.segmentSeeker,
                textDecoder: whisperKit.textDecoder,
                tokenizer: tokenizer,
                audioProcessor: whisperKit.audioProcessor,
                decodingOptions: decoding,
                requiredSegmentsForConfirmation: 2,
                silenceThreshold: 0.3,
                compressionCheckWindow: 20,
                useVAD: true,
                stateChangeCallback: { [weak self] _, newState in
                    Task { await self?.handleStateChange(newState) }
                }
            )
            transcriber = t
            streaming = true

            // startStreamTranscription runs the stream loop and only returns
            // after stopStreamTranscription is called. We fire it in a detached
            // Task so the command-processing loop stays responsive to `stop`.
            currentTask = Task { [weak self] in
                do {
                    try await t.startStreamTranscription()
                } catch {
                    TranscribeHelper.emit(["type": "error", "message": "stream error: \(error)"])
                }
                _ = self
            }
        }

        func handleStateChange(_ state: AudioStreamTranscriber.State) async {
            let confirmed = state.confirmedSegments
                .map { $0.text }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let hypothesis = state.unconfirmedSegments
                .map { $0.text }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)

            if confirmed == confirmedText && hypothesis == hypothesisText { return }
            confirmedText = confirmed
            hypothesisText = hypothesis

            let joined = [confirmed, hypothesis]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)

            emit(["type": "partial", "text": joined])
        }

        func stop() async {
            guard streaming, let t = transcriber else {
                // Even if we're not marked streaming, emit a final event so the
                // caller isn't left hanging.
                TranscribeHelper.emit(["type": "final", "text": ""])
                return
            }
            streaming = false

            await t.stopStreamTranscription()

            // Wait briefly for the detached stream task to wind down so the
            // final confirmed/hypothesis text is settled.
            if let task = currentTask {
                _ = await task.value
            }
            currentTask = nil

            let final = [confirmedText, hypothesisText]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            transcriber = nil
            TranscribeHelper.emit(["type": "final", "text": final])
        }
    }

    static func runStream(modelDir: String, language: String) async {
        writeStderr("loading model from \(modelDir) ...\n")

        let whisperKit: WhisperKit
        do {
            whisperKit = try await WhisperKit(
                modelFolder: modelDir,
                verbose: false,
                logLevel: .none,
                load: true
            )
        } catch {
            emit(["type": "error", "message": "model load failed: \(error)"])
            exit(1)
        }

        let controller = StreamController(whisperKit)
        emit(["type": "ready"])
        writeStderr("ready\n")

        let reader = LineReader(fileHandle: FileHandle.standardInput)
        while let line = reader.readLine() {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let cmd = obj["cmd"] as? String else { continue }

            writeStderr("cmd: \(cmd)\n")
            switch cmd {
            case "start":
                let lang = (obj["language"] as? String) ?? language
                await controller.start(language: lang)
                writeStderr("started\n")
            case "stop":
                await controller.stop()
                emit(["type": "stopped"])
                writeStderr("stopped\n")
            case "quit":
                await controller.stop()
                exit(0)
            default:
                emit(["type": "error", "message": "unknown cmd: \(cmd)"])
            }
        }
    }

    // MARK: - Utilities

    static func writeStderr(_ s: String) {
        FileHandle.standardError.write(s.data(using: .utf8) ?? Data())
    }

    static func emit(_ dict: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
           let s = String(data: data, encoding: .utf8) {
            print(s)
            fflush(stdout)
        }
    }

    static func parseNamed(_ args: [String], _ name: String) -> String? {
        guard let i = args.firstIndex(of: name) else { return nil }
        return args[safe: i + 1]
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// Simple blocking line reader over stdin. Using FileHandle.readLine would
// be async-friendly but we're in a dispatched context already; this keeps
// the protocol handling trivial.
final class LineReader {
    let handle: FileHandle
    var buffer = Data()

    init(fileHandle: FileHandle) {
        self.handle = fileHandle
    }

    func readLine() -> String? {
        let newline = Data([0x0A])
        while true {
            if let r = buffer.range(of: newline) {
                let lineData = buffer.subdata(in: buffer.startIndex..<r.lowerBound)
                buffer.removeSubrange(buffer.startIndex..<r.upperBound)
                return String(data: lineData, encoding: .utf8) ?? ""
            }
            let chunk = handle.availableData
            if chunk.isEmpty { return nil }
            buffer.append(chunk)
        }
    }
}
