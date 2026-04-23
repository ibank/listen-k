import Cocoa
import CoreGraphics
import IOKit.hid

let args = CommandLine.arguments

// --check: explicit permission query for dashboard.
if args.count >= 2 && args[1] == "--check" {
    let access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
    switch access {
    case kIOHIDAccessTypeGranted: exit(0)
    case kIOHIDAccessTypeDenied:  exit(1)
    default:                      exit(2)
    }
}

// Modes:
//   fn            — legacy fn (globe) single tap toggle
//   ropt-double   — Right Option (⌥) double-tap
//   rctl-double   — Right Control (⌃) double-tap
//   rcmd-double   — Right Command (⌘) double-tap
//   rshift-double — Right Shift (⇧) double-tap
let mode = args.count >= 2 ? args[1] : "rshift-double"

// No IOHIDCheckAccess gate: the tap below is listen-only and subscribes
// to `.flagsChanged` events only. macOS doesn't gate modifier-flag taps
// behind Input Monitoring (that permission guards keystroke content), so
// the tap creates successfully regardless of the TCC state of this
// helper. `--check` above is still offered for diagnostics callers that
// want to know the permission state explicitly.

// Virtual key codes (see HIToolbox/Events.h)
let KC_RIGHT_COMMAND: Int64 = 0x36
let KC_LEFT_COMMAND: Int64  = 0x37
let KC_LEFT_SHIFT: Int64    = 0x38
let KC_LEFT_OPTION: Int64   = 0x3A
let KC_LEFT_CONTROL: Int64  = 0x3B
let KC_RIGHT_SHIFT: Int64   = 0x3C
let KC_RIGHT_OPTION: Int64  = 0x3D
let KC_RIGHT_CONTROL: Int64 = 0x3E

var useFnMode = false
var watchedKey: Int64 = -1

switch mode {
case "fn":
    useFnMode = true
case "ropt-double":   watchedKey = KC_RIGHT_OPTION
case "rctl-double":   watchedKey = KC_RIGHT_CONTROL
case "rcmd-double":   watchedKey = KC_RIGHT_COMMAND
case "rshift-double": watchedKey = KC_RIGHT_SHIFT
default:
    FileHandle.standardError.write(
        "ERROR: unknown hotkey mode '\(mode)'\n".data(using: .utf8)!
    )
    exit(2)
}

var fnPressed: Bool = false
var keyIsDown: Set<Int64> = []
var lastTapTime: CFAbsoluteTime = 0
let DOUBLE_TAP_WINDOW: CFAbsoluteTime = 0.38

// Holds a reference to the CGEventTap so the callback can re-enable it
// after the system times it out. Assigned once tapCreate returns below;
// the callback only fires after CFRunLoopRun starts, by which point this
// has been written.
var tapRef: CFMachPort?

let callback: CGEventTapCallBack = { (_, type, event, _) in
    switch type {
    case .flagsChanged:
        if useFnMode {
            let isFnNow = event.flags.contains(.maskSecondaryFn)
            if isFnNow && !fnPressed {
                print("FN_DOWN")
                fflush(stdout)
            }
            fnPressed = isFnNow
        } else {
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            let wasDown = keyIsDown.contains(keyCode)
            if wasDown {
                keyIsDown.remove(keyCode)
            } else {
                keyIsDown.insert(keyCode)
                if keyCode == watchedKey {
                    let now = CFAbsoluteTimeGetCurrent()
                    if now - lastTapTime < DOUBLE_TAP_WINDOW && lastTapTime > 0 {
                        print("FN_DOWN")
                        fflush(stdout)
                        lastTapTime = 0
                    } else {
                        lastTapTime = now
                    }
                }
            }
        }

    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // The system disables a tap when its callback runs too slowly
        // or on various lifecycle edges (sleep/wake, fast user switch).
        // The previous comment promised "will be re-enabled by main"
        // but nothing in Electron ever did — taps stayed dead and the
        // hotkey silently stopped working until the user relaunched.
        // Re-enable in-place so the helper recovers transparently.
        FileHandle.standardError.write(
            "tap disabled (\(type == .tapDisabledByTimeout ? "timeout" : "userInput")) — re-enabling\n".data(using: .utf8)!
        )
        if let t = tapRef {
            CGEvent.tapEnable(tap: t, enable: true)
        }

    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)

// `.defaultTap` instead of `.listenOnly` — looks backwards, reads
// right once you know TCC's mapping. macOS gates CGEventTap on two
// different TCC services depending on `options`, not tap location:
//
//   .listenOnly → kTCCServiceListenEvent  (Input Monitoring)
//   .defaultTap → kTCCServicePostEvent    (Accessibility)
//
// The v0.7.6 "move the tap to .cgSessionEventTap" attempt did nothing
// — the prompt is tied to `options`, not `tap`. Since paste-helper
// already forces the user through the Accessibility prompt (for
// CGEvent.post when injecting ⌘V), switching fn-listener's tap to
// `.defaultTap` funnels us through the same service. The user sees a
// single Accessibility disclosure on first launch instead of one for
// Accessibility and a separate "키스트로크 받는 중" Input Monitoring
// one. Crucially, `.defaultTap` does not force modification — it
// just permits it. The callback still returns the event unchanged
// (line 102: `Unmanaged.passUnretained(event)`), so behaviourally
// this is identical to listen-only from the event-delivery side.
// `.headInsertEventTap` keeps us at the front of the session tap
// chain so we see flagsChanged events before any other filtering.
guard let tap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    FileHandle.standardError.write(
        "ERROR: CGEvent.tapCreate failed\n".data(using: .utf8)!
    )
    exit(1)
}

tapRef = tap
let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

print("READY mode=\(mode)")
fflush(stdout)

CFRunLoopRun()
