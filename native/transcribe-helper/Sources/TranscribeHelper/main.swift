import Foundation
import AVFoundation
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
            let hfCache = parseNamed(args, "--hf-cache")
            guard let modelDir else {
                writeStderr("error: --model-dir <dir> is required\n")
                exit(2)
            }
            await runStream(modelDir: modelDir, language: language, hfCache: hfCache)
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
        let hfCache = parseNamed(args, "--hf-cache")

        do {
            let whisperKit = try await WhisperKit(
                downloadBase: hfCache.map { URL(fileURLWithPath: $0, isDirectory: true) },
                modelFolder: modelDir,
                verbose: false,
                logLevel: .none,
                load: true
            )

            // Use WhisperKit's tuned defaults; only set the task, language
            // hint, and suppress timestamps. The previously hand-picked
            // overrides (temperatureFallbackCount: 3, sampleLength: 224)
            // were measurably worse than the library defaults — fewer
            // fallback passes on hard audio degrades non-English accuracy.
            let decodeOptions = DecodingOptions(
                task: .transcribe,
                language: language == "auto" ? nil : language,
                withoutTimestamps: true
            )

            let results = try await whisperKit.transcribe(
                audioPath: audioPath,
                decodeOptions: decodeOptions
            )

            let text = TranscribeHelper.stripTokens(
                results
                    .map { $0.text }
                    .joined(separator: " ")
            )

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
        var currentLanguage: String? = nil
        var audioBuffer: [Float] = []
        var lastLogSize: Int = -1

        init(_ wk: WhisperKit) {
            self.whisperKit = wk
        }

        func start(language: String) async {
            guard !streaming else { return }

            confirmedText = ""
            hypothesisText = ""
            audioBuffer = []
            currentLanguage = (language == "auto") ? nil : language

            guard let tokenizer = whisperKit.tokenizer else {
                emit(["type": "error", "message": "tokenizer unavailable"])
                return
            }

            // Library defaults for maximum quality (fallbackCount=5, etc.);
            // see batch path above.
            let decoding = DecodingOptions(
                task: .transcribe,
                language: language == "auto" ? nil : language,
                withoutTimestamps: true
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
            // Once we've started shutting down, ignore further partials so we
            // don't keep nudging the renderer's HUD after stop was issued.
            if !streaming { return }

            let bufSize = state.lastBufferSize
            if abs(bufSize - lastLogSize) > 16000 {
                TranscribeHelper.writeStderr(
                    "[audio] buf=\(bufSize) confirmed=\(state.confirmedSegments.count) unconfirmed=\(state.unconfirmedSegments.count)\n"
                )
                lastLogSize = bufSize
            }

            let confirmed = TranscribeHelper.stripTokens(
                state.confirmedSegments.map { $0.text }.joined(separator: " ")
            )
            let hypothesis = TranscribeHelper.stripTokens(
                state.unconfirmedSegments.map { $0.text }.joined(separator: " ")
            )

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
                TranscribeHelper.emit(["type": "final", "text": ""])
                return
            }
            streaming = false

            // Snapshot the audio buffer first — the AudioProcessor's
            // audioSamples array is the canonical capture record and may be
            // released once the stream is asked to stop.
            let captured: [Float] = Array(whisperKit.audioProcessor.audioSamples)

            // stopStreamTranscription has been observed to hang under some
            // WhisperKit/AudioProcessor combinations — the await never
            // returns and the helper's command loop wedges on the next
            // start. Fire it as a detached background task and cancel the
            // long-running start task so we can move straight to the batch
            // re-transcribe instead of blocking the user's fn-press.
            Task.detached { try? await t.stopStreamTranscription() }
            currentTask?.cancel()
            currentTask = nil

            transcriber = nil
            TranscribeHelper.writeStderr("[stop] captured \(captured.count) samples for final batch\n")

            var final = ""
            // Re-transcribe the full captured buffer in batch mode. This
            // avoids the streaming tail-drop where the last segment was in
            // flight when stop was issued — restores the Phase-1 accuracy
            // we lost when moving to streaming.
            if captured.count > 2000 {
                do {
                    let decode = DecodingOptions(
                        task: .transcribe,
                        language: currentLanguage,
                        withoutTimestamps: true
                    )
                    let results = try await whisperKit.transcribe(
                        audioArray: captured,
                        decodeOptions: decode
                    )
                    final = TranscribeHelper.stripTokens(
                        results.map { $0.text }.joined(separator: " ")
                    )
                    TranscribeHelper.writeStderr("[stop] batch result: \(final.count) chars\n")
                } catch {
                    TranscribeHelper.writeStderr("[stop] batch transcribe failed: \(error)\n")
                }
            } else {
                TranscribeHelper.writeStderr("[stop] skip batch (audio too short)\n")
            }

            // Fall back to whatever streaming produced if the batch pass
            // failed or produced nothing useful.
            if final.isEmpty {
                final = TranscribeHelper.stripTokens(
                    [confirmedText, hypothesisText]
                        .filter { !$0.isEmpty }
                        .joined(separator: " ")
                )
            }

            TranscribeHelper.emit(["type": "final", "text": final])
        }
    }

    static func runStream(modelDir: String, language: String, hfCache: String?) async {
        // Mic permission: this helper binary has its own TCC identity, so
        // it must be authorised independently of the Electron app that
        // spawned it. Without mic access, AudioStreamTranscriber reads
        // silence and Whisper hallucinates English phrases from its
        // training distribution ("I'm not even gonna…", "Thank you.",
        // " ♪", etc.) which surfaces as wildly wrong transcripts.
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        writeStderr("[init] mic status before request: \(micStatus)\n")

        if micStatus == .notDetermined {
            writeStderr("[init] requesting mic access…\n")
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            writeStderr("[init] mic request → \(granted)\n")
            if !granted {
                emit(["type": "error", "message": "마이크 권한이 거부되었습니다. 시스템 설정에서 허용해주세요."])
                exit(3)
            }
        } else if micStatus == .denied || micStatus == .restricted {
            emit(["type": "error", "message": "마이크 권한 없음. 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 Listen K.app 또는 transcribe-helper 를 허용해주세요."])
            writeStderr("[init] mic denied — aborting\n")
            exit(3)
        }
        writeStderr("[init] mic authorized\n")

        writeStderr("[init] loading WhisperKit from \(modelDir)\n")
        let t0 = Date()

        // Force CPU+GPU compute — skipping the Neural Engine avoids the
        // multi-minute first-run Core ML → ANE compilation. Inference is
        // still fast on Metal and this keeps the first launch under ~30s.
        let computeOptions = ModelComputeOptions(
            melCompute: .cpuAndGPU,
            audioEncoderCompute: .cpuAndGPU,
            textDecoderCompute: .cpuAndGPU,
            prefillCompute: .cpuAndGPU
        )

        // downloadBase tells WhisperKit (and its transitive swift-transformers
        // HubApi) where to read the tokenizer / config cache. Without it the
        // default is ~/Documents/huggingface/, which on macOS 14+ triggers a
        // TCC prompt for the Documents folder even though the user never
        // asked us to touch their documents. Pointing it into the app's own
        // Application Support directory keeps everything in a sandbox-safe
        // location that already has implicit access.
        let downloadBase = hfCache.map { URL(fileURLWithPath: $0, isDirectory: true) }
        if let downloadBase {
            try? FileManager.default.createDirectory(at: downloadBase, withIntermediateDirectories: true)
            writeStderr("[init] hf cache: \(downloadBase.path)\n")
        }

        let config = WhisperKitConfig(
            downloadBase: downloadBase,
            modelFolder: modelDir,
            computeOptions: computeOptions,
            verbose: true,
            logLevel: .debug,
            prewarm: true,
            load: true
        )

        let whisperKit: WhisperKit
        do {
            whisperKit = try await WhisperKit(config)
        } catch {
            emit(["type": "error", "message": "model load failed: \(error)"])
            writeStderr("[init] FAILED: \(error)\n")
            exit(1)
        }
        writeStderr("[init] WhisperKit loaded in \(String(format: "%.1f", Date().timeIntervalSince(t0)))s\n")

        if whisperKit.tokenizer == nil {
            writeStderr("[init] WARNING: tokenizer is nil — streaming will fail\n")
        } else {
            writeStderr("[init] tokenizer ready\n")
        }

        let controller = StreamController(whisperKit)
        emit(["type": "ready"])
        writeStderr("[init] ready event emitted\n")

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

    /// Remove Whisper's raw special tokens (`<|startoftranscript|>`,
    /// `<|en|>`, `<|transcribe|>`, `<|notimestamps|>`, `<|endoftext|>`,
    /// timestamp tokens, etc.) plus the leading space Whisper emits, and
    /// collapse runs of whitespace.
    static func stripTokens(_ raw: String) -> String {
        var s = raw
        if let re = try? NSRegularExpression(pattern: "<\\|[^|]*\\|>", options: []) {
            let range = NSRange(s.startIndex..., in: s)
            s = re.stringByReplacingMatches(in: s, options: [], range: range, withTemplate: "")
        }
        if let wsRe = try? NSRegularExpression(pattern: "\\s+", options: []) {
            let range = NSRange(s.startIndex..., in: s)
            s = wsRe.stringByReplacingMatches(in: s, options: [], range: range, withTemplate: " ")
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
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
