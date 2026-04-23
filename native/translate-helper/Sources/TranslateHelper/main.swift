import Foundation
import MLX
import MLXLLM
import MLXLMCommon

// Batch translation helper. Runs Gemma 3 via MLX-Swift entirely on-device.
// No networking, no Ollama dependency.
//
// Modes
//   --check
//       exit 0 when a model directory is wired up and importable
//   --model-dir <dir> --to <lang-name> [--max-tokens <N>]
//       read the source text from stdin, emit the translated text on stdout
//
// The stdin / stdout contract keeps the binary free of argv quoting issues
// with long multi-line input and makes it easy to pipe from Node.

@main
struct TranslateHelper {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())

        if args.first == "--check" {
            // Just verify the framework imported. A real model load happens
            // only on the first translate call.
            print("translate-helper ready")
            exit(0)
        }

        var modelDir: String?
        var targetLang: String = "English"
        var maxTokens: Int = 512

        var i = 0
        while i < args.count {
            switch args[i] {
            case "--model-dir":
                modelDir = args[safe: i + 1]; i += 2
            case "--to":
                targetLang = args[safe: i + 1] ?? "English"; i += 2
            case "--max-tokens":
                if let s = args[safe: i + 1], let v = Int(s) { maxTokens = v }
                i += 2
            default:
                i += 1
            }
        }

        guard let modelDir else {
            writeStderr("usage: --model-dir <dir> --to <lang> [--max-tokens N]  (input on stdin)\n")
            exit(2)
        }

        let sourceText = readAllStdin().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sourceText.isEmpty else {
            writeStderr("error: empty input on stdin\n")
            exit(2)
        }

        do {
            let url = URL(fileURLWithPath: modelDir, isDirectory: true)
            let config = ModelConfiguration(directory: url)

            writeStderr("[init] loading \(modelDir)\n")
            let t0 = Date()
            let container = try await LLMModelFactory.shared.loadContainer(
                configuration: config
            ) { _ in }
            writeStderr("[init] loaded in \(String(format: "%.1f", Date().timeIntervalSince(t0)))s\n")

            let prompt = buildPrompt(text: sourceText, targetLanguage: targetLang)

            let parameters = GenerateParameters(
                maxTokens: maxTokens,
                temperature: 0.2,
                topP: 0.9
            )

            // Disambiguate the two `generate` overloads by annotating the
            // callback — we want the [Int] variant, which returns a full
            // GenerateResult with the decoded `output: String`.
            let output: String = try await container.perform { context in
                let input = try await context.processor.prepare(
                    input: UserInput(prompt: prompt)
                )
                let result = try MLXLMCommon.generate(
                    input: input,
                    parameters: parameters,
                    context: context,
                    didGenerate: { (_: [Int]) -> GenerateDisposition in
                        return .more
                    }
                )
                return result.output
            }

            let trimmed: String = output.trimmingCharacters(in: .whitespacesAndNewlines)
            print(trimmed)
            fflush(stdout)
        } catch {
            writeStderr("error: \(error)\n")
            exit(1)
        }
    }

    static func buildPrompt(text: String, targetLanguage: String) -> String {
        return """
        You are a professional translator. Translate the user's text to \(targetLanguage).
        Preserve the original meaning, tone, and formatting. Output only the translation — no explanation, no quotes, no preamble.

        Text:
        \(text)

        Translation:
        """
    }

    static func readAllStdin() -> String {
        var data = Data()
        let handle = FileHandle.standardInput
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { break }
            data.append(chunk)
        }
        return String(data: data, encoding: .utf8) ?? ""
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
