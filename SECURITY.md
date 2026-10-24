# Security

SumIT runs on the student's own PC. There is no server, account or telemetry of our own.

## How it is protected

| Area | How it is protected | Verified by |
|---|---|---|
| Network exposure | The app opens no listening TCP port. | Self test and `Get-NetTCPConnection` on the app and its WebView2 processes |
| App page isolation | The UI is served from `web\` only (virtual host `app.local`). It can't read `browser-data`, `settings.json` or anything else, and can't navigate away; a strict Content-Security-Policy allows only its own scripts and styles. | Self test: `/../settings.json`, `%2e%2e`, `browser-data/...` all blocked |
| Messages | Messages are accepted only from the app page (`https://app.local/`); page-script results only from `*.hit.ac.il`, `*.zoom.us` and `cs24.co.il`. | Code review |
| Downloads | Moodle files are fetched only from `https://md.hit.ac.il`; a redirect elsewhere is dropped. Recording links must be `https://*.zoom.us/rec/...`. File names are sanitised (no `..`, `\`, `/`, reserved names); a destination chosen by the page is limited to the course's own folders. Links that want a new window open in the same view. | Regression tests (destination and name checks), download tests against a local server |
| Opening files | Only files inside the app's folders, and only document/media types. An `.exe`, `.bat` or script is shown in Explorer instead of run. | Code review |
| Claude | May read and write in the course folder and run Python (the study skill needs it). Web access, `curl`, `wget`, PowerShell, `cmd`, `rm` and `del` are blocked, and the prompt says file contents are material, never instructions. | Self test: asked to `curl` a site, Claude was refused |
| Gemini / ChatGPT (optional helpers) | Connected with the student's **own account** (their Google account / ChatGPT plan), no key needed. The app installs the vendors' official command-line tools (`@google/gemini-cli`, `@openai/codex`) into its own folder and opens the vendor's sign-in page in the browser; the app never sees the password. They are used for text only, in an empty temporary folder with a read-only sandbox: no file access, only the question and text the app already has (lecture summaries and homework solutions to be double-checked, a syllabus, a timetable page). An API key is still possible as an alternative; it travels in a request header and is never logged. | Tests with fake tools and a local fake server; a real ChatGPT round trip |
| Secrets | The sign-in tokens are kept by the vendors' tools in their own folders, as when signing in to them directly (`~/.codex`, `~/.gemini`); the app doesn't read them. API keys, if used, are stored encrypted with Windows DPAPI (current user only) and saved only after a test request answered. | Self test (DPAPI round trip) |
| Updates | The app checks the project's GitHub releases and **asks** before installing. The package is verified against its published SHA-256 before anything is copied, and only releases from this repository are accepted. | Code review |

## What leaves the PC

- **Claude** (Anthropic): the course files Claude reads to build a summary, under the student's own Claude account.
- **Gemini / ChatGPT**, only if the student connects their account (or a key): chat questions about a lecture, the text of a summary with its homework solutions (for the second check) and earlier lecture digests, syllabus text and the text of an HIT page the student asked to read. It goes to Google / OpenAI under the student's own account and their terms. Nothing else, and nothing when no account is connected (or when "Claude only" is chosen in Settings).
- Nothing goes to the project's maintainers.

## What it can't protect against

- Anyone who can use your Windows account can use your HIT sign-in from `browser-data`. Lock your PC.
- The executable isn't code-signed, so Windows SmartScreen warns on first run.
- The AI may run Python for the study skill. Claude Code's own safeguards and the instructions above limit this, but a crafted document could still try to influence it. Only add course material from sources you trust.
- Course files in OneDrive are as private as your OneDrive account.

## Reporting

Open an issue on GitHub (without personal data), or contact the maintainer privately.
