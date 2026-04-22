// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "transcribe-helper",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.13.0"),
    ],
    targets: [
        .executableTarget(
            name: "TranscribeHelper",
            dependencies: [
                .product(name: "WhisperKit", package: "WhisperKit"),
            ]
        ),
    ]
)
