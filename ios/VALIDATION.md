# Ticket 01 native validation

Date: 2026-10-11. Toolchain: Xcode 27.0; minimum supported OS: iOS 26.

## Verified

- Public XCTest package: four tests passed. Includes HTTPS/QR input validation, non-default port authority, public JSON DTOs, inspection without credential transmission, public claim error/idempotency contract, and decoding exact backend versioned `contracts/examples` files. Backend separately validates those examples against its schemas.
- iOS 26.5 iPhone 17 Pro simulator: signed native initial navigation/manual failure test passed. Unsigned simulator builds cannot exercise Keychain; CI uses ad-hoc signing.
- Connected physical Alchemist iPhone: signed app built, installed and launched. Native live test passed on a real HTTPS tunnel backed by the real PostgreSQL fixture: inspect metadata, explicitly confirm host/data destinations, pair, store credentials in Keychain, terminate/relaunch, verify authenticated session identity, revoke, return to unpaired form. One test, zero failures, 27.140 seconds. Private result: `/tmp/nivli-device-build/Logs/Test/Test-Nivli-2026.10.11_14-27-46--0700.xcresult`.
- Final physical functional regression: three tests, zero failures (camera denial/unavailable → manual pairing; dark navigation/manual failure; light navigation/manual failure). Initial launch requested no permissions. Retained pending pairing input is explicitly replaced with an invalid HTTP address by the failure tests, so their result is independent of Keychain state.
- Local credential removal/re-pair recovery is available with an explicit distinction from server revocation; the final signed build includes this control.

## Scope and limitations

This evidence covers environment pairing, navigation and session restoration. It does not claim local/APNs notification delivery, geographic triggers, Gmail or future reminder functionality.

An additional accessibility audit reported dynamic-font/contrast issues in empty states and grouped form content. Semantic fonts, accessible action colors, persistent input labels, 44-point actions and scanner focus restoration were improved. Full formal accessibility audit has not passed. The user explicitly waived accessibility as an acceptance gate (“我不在乎无障碍，直接推进”); audit iteration stopped and the new audit gate test was removed. Functional tests remain.

The first unsigned simulator live claim created an active device but failed to save Keychain credentials. A subsequent physical test correctly displayed primary-device-exists. The isolated fixture was reset through the administrator API, then the signed physical live test passed. A first physical test runner initialization timed out until the user unlocked the phone and allowed prompts; this was not an application success result.

Ephemeral pairing inputs are excluded from Git. Raw result bundles stay private; only result summaries are delivered. The committed default project has no live credentials or fixture resource reference. Optional live test skips without an explicitly provisioned private fixture.
