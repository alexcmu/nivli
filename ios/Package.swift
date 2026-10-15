// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "HaijiCore", platforms: [.iOS("26.0"), .macOS(.v14)], products: [.library(name: "HaijiCore", targets: ["HaijiCore"])], targets: [.target(name: "HaijiCore", linkerSettings: [.linkedLibrary("sqlite3")]), .testTarget(name: "HaijiCoreTests", dependencies: ["HaijiCore"])])
