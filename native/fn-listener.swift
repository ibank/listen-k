import Cocoa
import CoreGraphics

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
        ("ERROR: CGEvent.tapCreate failed. " +
         "시스템 설정 → 개인정보 보호 → 입력 모니터링에서 bin/fn-listener 허용 필요.\n")
        .data(using: .utf8)!
    )
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

print("READY")
fflush(stdout)

CFRunLoopRun()
