import Foundation
import Speech
import AVFoundation

// Apple SFSpeechRecognizer-based transcription helper. Same streaming
// protocol as transcribe-helper --stream so main.js can route to either
// engine interchangeably:
//
//   --check                                   exit 0 authorised, 1 denied, 2 not-determined
//   --stream [--language ko-KR|ko|auto|…]     NDJSON stdin/stdout protocol
//
// stdin commands:  {"cmd":"start"}  {"cmd":"stop"}  {"cmd":"quit"}
// stdout events:   {"type":"ready"} {"type":"partial","text":"…"}
//                  {"type":"final","text":"…"} {"type":"stopped"}
//                  {"type":"error","message":"…"}

let args = Array(CommandLine.arguments.dropFirst())

if args.first == "--check" {
    let speech = SFSpeechRecognizer.authorizationStatus()
    switch speech {
    case .authorized: exit(0)
    case .denied, .restricted: exit(1)
    case .notDetermined: exit(2)
    @unknown default: exit(2)
    }
}

guard args.first == "--stream" else {
    writeStderr("usage: --check | --stream [--language <code>]\n")
    exit(2)
}

// ----- language normalisation -----
var localeId = "ko-KR"
if let i = args.firstIndex(of: "--language"), i + 1 < args.count {
    let raw = args[i + 1]
    if raw == "auto" {
        localeId = Locale.current.identifier
    } else if raw.contains("-") {
        localeId = raw
    } else {
        let map = ["ko": "ko-KR", "en": "en-US", "ja": "ja-JP"]
        localeId = map[raw] ?? raw
    }
}

// ----- permissions -----
func requestSpeechAuth() -> Bool {
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    SFSpeechRecognizer.requestAuthorization { status in
        ok = (status == .authorized)
        sem.signal()
    }
    sem.wait()
    return ok
}

func ensureMicAuth() -> Bool {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    if status == .authorized { return true }
    if status == .denied || status == .restricted { return false }
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        ok = granted
        sem.signal()
    }
    sem.wait()
    return ok
}

if !requestSpeechAuth() {
    emit(["type": "error", "message": "Speech Recognition permission is required. Open System Settings → Privacy & Security → Speech Recognition and enable Listen K."])
    exit(3)
}
writeStderr("[init] speech authorized\n")

if !ensureMicAuth() {
    emit(["type": "error", "message": "Microphone permission denied."])
    exit(3)
}
writeStderr("[init] mic authorized\n")

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
    emit(["type": "error", "message": "No speech recognizer is available for locale \(localeId)."])
    exit(1)
}

let supportsOnDevice = recognizer.supportsOnDeviceRecognition
writeStderr("[init] recognizer locale=\(localeId) onDevice=\(supportsOnDevice)\n")

// ----- streaming state -----
let audioEngine = AVAudioEngine()
var currentRequest: SFSpeechAudioBufferRecognitionRequest?
var currentTask: SFSpeechRecognitionTask?
var streaming = false
let lock = NSLock()

func startStream() {
    lock.lock(); defer { lock.unlock() }
    if streaming { return }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if supportsOnDevice {
        request.requiresOnDeviceRecognition = true
    }
    currentRequest = request

    currentTask = recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
            let text = result.bestTranscription.formattedString
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if result.isFinal {
                emit(["type": "final", "text": text])
                streaming = false
                currentRequest = nil
                currentTask = nil
            } else if !text.isEmpty {
                emit(["type": "partial", "text": text])
            }
        }
        if let err = error {
            // Cancelled stops are a normal path — don't surface those as errors.
            let nsErr = err as NSError
            if !(nsErr.domain == "kAFAssistantErrorDomain" && nsErr.code == 216) {
                emit(["type": "error", "message": "\(err.localizedDescription)"])
            }
        }
    }

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
    }

    audioEngine.prepare()
    do {
        try audioEngine.start()
        streaming = true
    } catch {
        emit(["type": "error", "message": "audio start failed: \(error.localizedDescription)"])
        currentTask?.cancel()
        currentTask = nil
        currentRequest = nil
    }
}

func stopStream() {
    lock.lock()
    let wasStreaming = streaming
    streaming = false
    lock.unlock()
    if !wasStreaming { return }

    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    currentRequest?.endAudio()  // triggers isFinal through the recognitionTask callback
}

// ----- stdin command loop on a background thread -----
DispatchQueue.global(qos: .userInitiated).async {
    let reader = LineReader(fileHandle: FileHandle.standardInput)
    while let line = reader.readLine() {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else { continue }
        writeStderr("[cmd] \(cmd)\n")

        DispatchQueue.main.async {
            switch cmd {
            case "start":
                startStream()
            case "stop":
                stopStream()
                // emit stopped after a brief settle so any in-flight final
                // has a chance to arrive via the recognitionTask callback.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    emit(["type": "stopped"])
                }
            case "quit":
                stopStream()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    exit(0)
                }
            default:
                emit(["type": "error", "message": "unknown cmd: \(cmd)"])
            }
        }
    }
}

emit(["type": "ready"])
writeStderr("[init] ready\n")

CFRunLoopRun()

// ----- utilities -----

func emit(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let s = String(data: data, encoding: .utf8) {
        print(s)
        fflush(stdout)
    }
}

func writeStderr(_ s: String) {
    FileHandle.standardError.write(s.data(using: .utf8) ?? Data())
}

final class LineReader {
    let handle: FileHandle
    var buffer = Data()
    init(fileHandle: FileHandle) { self.handle = fileHandle }
    func readLine() -> String? {
        let nl = Data([0x0A])
        while true {
            if let r = buffer.range(of: nl) {
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
