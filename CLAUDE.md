# SumIT

Study app for HIT students. The UI is Hebrew and RTL.

## Layout
- `src/*.cs`: the Windows app (C#, WebView2). These files use CRLF line endings; keep them.
- `macos/`: the macOS Electron port. `macos/lib/modules/*.js` mirror `src/*.cs` one-to-one (each file says which C# file it ports).
  A logic change goes into both, with a test in both `macos/scripts/offline-tests.js` and `tests/RegressionTests.cs`.
  macOS-only features have no C# counterpart: flashcards, spaced repetition (`reviews.js`), the pomodoro system alert (`pomodoro.js`), calendars (`calendars.js`), "I'm stuck" (`coach.js`) and "what to do in this block" (`block-plan.js`) and the study track, beta (`study-track.js`: a first-run wizard in `src/web/track-wizard.js` that asks about the student's routine and reads the connected calendars for weekly commitments, courses with a difficulty and an energy, a strategy per course, study tasks read from the course folders, a week of blocks that puts heavy courses in the hours of most energy, progress kept in a local profile file with export and import, and a streak as in Duolingo: a day counts when a block or a topic was finished in it, a freeze earned every 7 days covers a missed day, a celebration when the flame lights and an evening reminder at 20:00), and the study tools (`study-export.js`: the week's blocks as an iCal file, a folder of sources for NotebookLM, the cards as an Anki text file, the summary PDFs of a course to iCloud Drive `SumIT/<course>/Lecture_NN_<topic>.pdf` with a `metadata.json` for the iPad; they are buttons in the study track page), and the sync of the study blocks into the Calendar app of macOS (`calendar-sync.js`, with the script macOS runs in `macos/lib/scripts/calendar-sync.jxa.js`; the tests use a fake Calendar and must never reach the real one), and "המחשה חזותית" (`visual.js`: a button on each homework question of a summary, added to the page when it is shown by `src/web/study-viz.js`; a helper AI gets only the question and answers with a short JSON spec that `src/web/viz-runtime.js` checks and draws (plot, wave, circuit with mesh-current loops and colored equations, field3d, or a small custom HTML; a "board" style looks like a blackboard) in a sandboxed frame with no network, styled by `src/web/viz-frame.css`; kept in `.sumit-viz/` next to the summary), and the sync with Google Drive (`drive-sync.js`, card in `src/web/drive-ui.js`: sign-in with Google through the browser, PKCE and a 127.0.0.1 redirect, scope `drive.file` only; the study folder mirrored into a "SumIT" Drive folder, a three-way compare with the state of the last sync in `drive-sync.json`, both versions kept on a conflict, deletes to the Trash, a stop before mass deletes, and the settings without keys or folders; the client id is in `constants.js`, the client secret comes from `SUMIT_GOOGLE_CLIENT_SECRET` or `macos/lib/google-oauth.json`, which the release workflow writes from the repository secret `GOOGLE_OAUTH_CLIENT_SECRET`; the tests use a fake Google and never reach the real one)., and the reminder of the tasks ticket (`task-reminders.js`: the page sends the items due in the next two days, and from 09:00 each one due tomorrow gets one system notification; what was said is kept in `task-reminders.json` as "id|date"; the ticket itself, `src/web/tasks-ticket.js` and `tasks-ticket-ui.js`, is shared and needs no host). Their UI is in `src/web/` and stays hidden on Windows until the host answers.
- `src/web/`: the web UI shared by both apps.
- `docs/`: screenshots and release notes (`release-<version>.md`, in Hebrew).

## Checks (from `macos/`)
- `npm install` once, then `npm test`. Expected: `33 Host mixin modules loaded cleanly` and `ALL 519 OFFLINE REGRESSION CHECKS PASSED` (update the count when tests are added).
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
