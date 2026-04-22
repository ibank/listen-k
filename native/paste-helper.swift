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
        ("ERROR: paste-helper is missing the Accessibility permission.\n" +
         "Open System Settings → Privacy & Security → Accessibility, click +, add this binary, and toggle it ON.\n")
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
