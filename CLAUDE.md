# SumIT

Study app for HIT students. The UI is Hebrew and RTL.

## Layout
- `src/*.cs`: the Windows app (C#, WebView2). These files use CRLF line endings; keep them.
- `macos/`: the macOS Electron port. `macos/lib/modules/*.js` mirror `src/*.cs` one-to-one (each file says which C# file it ports).
  A logic change goes into both, with a test in both `macos/scripts/offline-tests.js` and `tests/RegressionTests.cs`.
- `src/web/`: the web UI shared by both apps.
- `docs/`: screenshots and release notes (`release-<version>.md`, in Hebrew).

## Checks (from `macos/`)
- `npm install` once, then `npm test`. Expected: `22 Host mixin modules loaded cleanly` and `ALL 99 OFFLINE REGRESSION CHECKS PASSED` (update the count when tests are added).
- Needs Node 23 or newer: `macos/lib/modules/summary-share.js` uses a regex with duplicate named groups. On Node 22, run the scripts with `node --js-regexp-duplicate-named-groups`.
- The C# code can only be built on Windows.

## Run and build (macOS only)
- `npm start` runs with the real accounts; `npm run demo` runs without Moodle or AI.
- `npm run dist:arm64` builds `macos/dist/SumIT-<version>-arm64.dmg` and `.zip`.

## Releases
- Bump the version in `macos/package.json` and `macos/lib/constants.js`, add `docs/release-<version>.md` in Hebrew, and add a line at the top of the README.
- Release tag `v<version>-mac` on `ItayOssi/SumIT`, with the DMG and the ZIP attached.

## Rules
- Push only to `ItayOssi/SumIT` (the user's fork). Never push to `Pinkel-Kinkel/SumIT`.
- Write release notes and messages to the user in Hebrew.
