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
let mode = args.count >= 2 ? args[1] : "ropt-double"

let access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
if access != kIOHIDAccessTypeGranted {
    let reason: String
    switch access {
    case kIOHIDAccessTypeDenied: reason = "denied"
    default: reason = "not-determined"
    }
    FileHandle.standardError.write(
        "ERROR: Input Monitoring \(reason)\n".data(using: .utf8)!
    )
    exit(2)
}

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
        FileHandle.standardError.write(
            "tap disabled, will be re-enabled by main\n".data(using: .utf8)!
        )

    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    FileHandle.standardError.write(
        "ERROR: CGEvent.tapCreate failed\n".data(using: .utf8)!
    )
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

print("READY mode=\(mode)")
fflush(stdout)

CFRunLoopRun()
