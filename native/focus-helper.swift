import Cocoa

let args = CommandLine.arguments

guard args.count >= 2 else {
    FileHandle.standardError.write(
        "usage: focus-helper get-frontmost | activate <bundle-id>\n".data(using: .utf8)!
    )
    exit(2)
}

switch args[1] {
case "get-frontmost":
    if let app = NSWorkspace.shared.frontmostApplication,
       let bundleId = app.bundleIdentifier {
        print(bundleId)
    } else {
        FileHandle.standardError.write("no frontmost app\n".data(using: .utf8)!)
        exit(1)
    }

case "activate":
    guard args.count >= 3 else {
        FileHandle.standardError.write("activate requires a bundle id\n".data(using: .utf8)!)
        exit(2)
    }
    let bundleId = args[2]
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
    guard let target = running.first else {
        FileHandle.standardError.write("app not running: \(bundleId)\n".data(using: .utf8)!)
        exit(1)
    }
    let ok = target.activate(options: [.activateIgnoringOtherApps])
    if !ok {
        FileHandle.standardError.write("activate returned false for \(bundleId)\n".data(using: .utf8)!)
        exit(1)
    }

default:
    FileHandle.standardError.write("unknown command: \(args[1])\n".data(using: .utf8)!)
    exit(2)
}
