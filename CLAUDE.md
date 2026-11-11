# SumIT

Study app for HIT students. The UI is Hebrew and RTL.

## Layout
- `src/*.cs`: the Windows app (C#, WebView2). These files use CRLF line endings; keep them.
- `macos/`: the macOS Electron port. `macos/lib/modules/*.js` mirror `src/*.cs` one-to-one (each file says which C# file it ports).
  A logic change goes into both, with a test in both `macos/scripts/offline-tests.js` and `tests/RegressionTests.cs`.
  macOS-only features have no C# counterpart: flashcards, spaced repetition (`reviews.js`), the pomodoro system alert (`pomodoro.js`), calendars (`calendars.js`), "I'm stuck" (`coach.js`) and "what to do in this block" (`block-plan.js`) and the study track, beta (`study-track.js`: a first-run wizard in `src/web/track-wizard.js` that asks about the student's routine and reads the connected calendars for weekly commitments, courses with a difficulty and an energy, a strategy per course, study tasks read from the course folders, a week of blocks that puts heavy courses in the hours of most energy, progress kept in a local profile file with export and import), and the study tools (`study-export.js`: the week's blocks as an iCal file, a folder of sources for NotebookLM, the cards as an Anki text file, the summary PDFs of a course to iCloud Drive `SumIT/<course>/Lecture_NN_<topic>.pdf` with a `metadata.json` for the iPad; they are buttons in the study track page), and the sync of the study blocks into the Calendar app of macOS (`calendar-sync.js`, with the script macOS runs in `macos/lib/scripts/calendar-sync.jxa.js`; the tests use a fake Calendar and must never reach the real one). Their UI is in `src/web/` and stays hidden on Windows until the host answers.
- `src/web/`: the web UI shared by both apps.
- `docs/`: screenshots and release notes (`release-<version>.md`, in Hebrew).

## Checks (from `macos/`)
- `npm install` once, then `npm test`. Expected: `30 Host mixin modules loaded cleanly` and `ALL 415 OFFLINE REGRESSION CHECKS PASSED` (update the count when tests are added).
- Needs Node 23 or newer: `macos/lib/modules/summary-share.js` uses a regex with duplicate named groups. On Node 22, run the scripts with `node --js-regexp-duplicate-named-groups`.
- The C# code can only be built on Windows.

## Run and build (macOS only)
- `npm start` runs with the real accounts; `npm run demo` runs without Moodle or AI.
- `npm run dist:arm64` builds `macos/dist/SumIT-<version>-arm64.dmg` and `.zip`.

## Releases
- Bump the version in `macos/package.json` and `macos/lib/constants.js`, add `docs/release-<version>.md` in Hebrew, and add a line at the top of the README.
- Release tag `v<version>-mac` on `ItayOssi/SumIT`, with the DMG and the ZIP attached. Pushing the tag (`git tag v<version>-mac && git push origin v<version>-mac`), or running the "Release macOS" workflow by hand on `main` (it then creates the tag), runs `.github/workflows/release-mac.yml`: it tests, builds on a GitHub Mac and publishes the release with `docs/release-<version>.md` as the notes. The app's automatic update reads these releases.

## Rules
- Push only to `ItayOssi/SumIT` (the user's fork). Never push to `Pinkel-Kinkel/SumIT`.
- Write release notes and messages to the user in Hebrew.
