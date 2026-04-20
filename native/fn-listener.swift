import Cocoa
import CoreGraphics
import IOKit.hid

let args = CommandLine.arguments

// --check: explicit query for dashboard. Returns 0 granted, 1 denied, 2 unknown.
if args.count >= 2 && args[1] == "--check" {
    let access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
    switch access {
    case kIOHIDAccessTypeGranted: exit(0)
    case kIOHIDAccessTypeDenied:  exit(1)
    default:                      exit(2)
    }
}

// Fail fast if Input Monitoring is not actually granted.
// CGEvent.tapCreate(.listenOnly) can silently succeed without the permission
// on some macOS configurations, so rely on IOHIDCheckAccess instead of
// trusting tapCreate's return value.
let access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
if access != kIOHIDAccessTypeGranted {
    let reason: String
    switch access {
    case kIOHIDAccessTypeDenied: reason = "denied"
    default: reason = "not-determined"
    }
    FileHandle.standardError.write(
        "ERROR: Input Monitoring \(reason). 시스템 설정에서 Listen K.app 을 허용해주세요.\n"
            .data(using: .utf8)!
    )
    exit(2)
}

var fnPressed: Bool = false

let callback: CGEventTapCallBack = { (_, type, event, _) in
    switch type {
    case .flagsChanged:
        let isFnNow = event.flags.contains(.maskSecondaryFn)
        if isFnNow && !fnPressed {
            print("FN_DOWN")
            fflush(stdout)
        }
        fnPressed = isFnNow
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
        "ERROR: CGEvent.tapCreate failed.\n".data(using: .utf8)!
    )
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

print("READY")
fflush(stdout)

CFRunLoopRun()
