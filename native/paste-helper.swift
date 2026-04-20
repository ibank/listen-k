import Cocoa
import CoreGraphics
import ApplicationServices

let args = CommandLine.arguments

// --check: non-prompting query, exit 0 if trusted, 1 if not. Used by onboarding.
if args.count >= 2 && args[1] == "--check" {
    exit(AXIsProcessTrusted() ? 0 : 1)
}

// Verify Accessibility permission; if missing, prompt and exit with clear error.
let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
let opts = [promptKey: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(opts) {
    FileHandle.standardError.write(
        ("ERROR: paste-helper에 손쉬운 사용(Accessibility) 권한이 없습니다.\n" +
         "시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → + 버튼으로 이 바이너리를 추가 후 토글 ON.\n")
        .data(using: .utf8)!
    )
    exit(3)
}

guard let src = CGEventSource(stateID: .combinedSessionState) else {
    FileHandle.standardError.write("failed to create CGEventSource\n".data(using: .utf8)!)
    exit(1)
}

let kVK_ANSI_V: CGKeyCode = 0x09

let down = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_V, keyDown: true)
let up   = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_V, keyDown: false)
down?.flags = .maskCommand
up?.flags   = .maskCommand

let tap: CGEventTapLocation = .cghidEventTap
down?.post(tap: tap)
usleep(15000)
up?.post(tap: tap)

print("PASTED")
