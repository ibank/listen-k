import Foundation
import WhisperKit

// Modes:
//   --check
//       exit 0 when the helper is runnable (used by onboarding dashboard)
//   --download <variant> <dest-root>
//       download the WhisperKit Core ML model bundle to <dest-root>/<variant>/
//   --audio <wav> --model-dir <dir> [--language <code>]
//       batch transcribe a WAV file; prints final text to stdout
//
// Phase 2 will add a persistent streaming mode that owns microphone capture
// and emits NDJSON partial/final events.

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

        await runBatch(args: args)
    }

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

    static func runBatch(args: [String]) async {
        var audioPath: String?
        var modelDir: String?
        var language: String = "auto"

        var i = 0
        while i < args.count {
            switch args[i] {
            case "--audio":
                audioPath = args[safe: i + 1]
                i += 2
            case "--model-dir":
                modelDir = args[safe: i + 1]
                i += 2
            case "--language":
                language = args[safe: i + 1] ?? "auto"
                i += 2
            default:
                i += 1
            }
        }

        guard let audio = audioPath else {
            writeStderr("error: --audio <path> is required\n")
            exit(2)
        }
        guard let model = modelDir else {
            writeStderr("error: --model-dir <dir> is required\n")
            exit(2)
        }

        do {
            let whisperKit = try await WhisperKit(
                modelFolder: model,
                verbose: false,
                logLevel: .none,
                load: true
            )

            let decodeOptions = DecodingOptions(
                language: language == "auto" ? nil : language,
                withoutTimestamps: true
            )

            let results = try await whisperKit.transcribe(
                audioPath: audio,
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

    static func writeStderr(_ s: String) {
        FileHandle.standardError.write(s.data(using: .utf8) ?? Data())
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
