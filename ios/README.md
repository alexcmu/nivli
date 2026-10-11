# Nivli iOS

Native SwiftUI iPhone app, minimum iOS 26. Open `Nivli.xcodeproj` in Xcode 26 or newer. Choose your own bundle identifier and development team, and enable automatic signing for a physical device. Simulator tests use ad-hoc signing (`CODE_SIGN_IDENTITY=-`) so Keychain entitlements are active. For a physical device, use your development identity and team. Project regeneration is optional (`ruby generate-project.rb`, requires xcodeproj gem).

Run public JSON/HTTP-boundary XCTest with `swift test --package-path ios` from the repository root. Run native UI regression:

```sh
xcodebuild -project ios/Nivli.xcodeproj -scheme Nivli -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGN_IDENTITY=- test
```

This increment supports manual HTTPS pairing and camera QR JSON `{ "serverUrl": "https://your-host", "code": "one-time-code" }`. Environment metadata is fetched before explicit confirmation transmits the pairing code. Input URLs exclude user info, queries, fragments, and non-root paths; HTTP redirects are rejected. The UI preserves one idempotency key per claim attempt across retries. Device credentials and in-progress renewal keys are stored in Keychain with device-only accessibility; renewal rotates credentials. Stored session identity is checked at launch. Failed connectivity keeps saved credentials and displays “待验证连接”; successful revocation deletes the Keychain item.

Time reminders, AI instructions and Gmail consent/configuration are available in their implemented scopes; memory, location and data control remain pending. The conversation preserves drafts, polls durable runs, installs genuine reminder occurrences and keeps manual fallback available. Server model configuration is documented in `docs/model.md`. Initial launch requests no permissions. Camera access is requested only after choosing scan, and denial retains manual pairing. Native system fonts/colors, grouped forms, tabs and navigation support light/dark and Dynamic Type.

Physical notification/APNs/location validation belongs to later ticket scopes. These UI tests do not establish notification delivery or geographic behavior.

The optional live pairing UI test skips without `UITests/LiveFixture.json`. In an isolated environment, create this ignored file containing only `serverUrl` and a fresh `code`, regenerate the project to include it in the **test bundle**, then run only `testZLivePairingRestoresAndRevokesSession`. It consumes the one-time code, checks authenticated restoration after relaunch, and revokes the session. Remove the file, regenerate, and clean derived build products before committing or running default tests; Xcode can otherwise retain a stale copied resource. Keep test result bundles private: they may contain temporary environment metadata; never publish pairing credentials. The default project includes no test credentials.

Swift DTO contract tests read the repository's `contracts/examples/*.json`, which the backend validates against its versioned schemas. The HTTP substitute is only at URLSession's external transport boundary; production app state/Keychain are not mocked in native UI tests.

If a server session has already been revoked or network access is unavailable, “移除此 iPhone 的连接” offers explicit local credential removal. It does not revoke the server session; the UI explains that an administrator may need to revoke the old primary device before pairing again.
