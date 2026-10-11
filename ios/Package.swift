// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "NivliCore", platforms: [.iOS("26.0"), .macOS(.v14)], products: [.library(name: "NivliCore", targets: ["NivliCore"])], targets: [.target(name: "NivliCore"), .testTarget(name: "NivliCoreTests", dependencies: ["NivliCore"])])
