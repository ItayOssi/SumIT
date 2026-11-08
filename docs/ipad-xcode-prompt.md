# פרומט ל-Xcode: ייבוא מהמק לאפליקציית SumIT לאייפד

> מעתיקים את כל מה שמתחת לקו אל ה-assistant של Xcode, בתוך הפרויקט `SumIT.xcodeproj`. הפרומט עומד בפני עצמו, וה-assistant לא צריך גישה לריפו של המק. המבנה המלא של הקבצים נמצא גם ב-`docs/icloud-format.md`.

---

## Task: import courses, summaries and flashcards that the SumIT Mac app exports to iCloud Drive

The SumIT Mac app (version 1.0.37 and later) exports each course to the student's **iCloud Drive**, under `iCloud Drive/SumIT/`. Add a one-way import to this iPad app: the student connects the `SumIT` folder once, and from then on the app brings in the courses, lectures, summaries and flashcards from it. Do not change the Moodle sync, the Claude features or the existing UI beyond what is listed here.

### What the Mac writes (schema 1)

```
SumIT/
├── index.json
└── <course folder>/
    ├── metadata.json
    ├── cards.json                      (only when the course has cards)
    ├── Lecture_01_<topic>.pdf          (the summary PDF, when the lecture has one)
    └── Lecture_02_<topic>.md           (the summary in Markdown, when the lecture has one)
```

`SumIT/index.json`:
```json
{ "schema": 1, "app": "SumIT", "version": "1.0.37", "updatedAt": "2026-11-08T12:30:00.000Z",
  "courses": [ { "folder": "אלגברה לינארית 2 - תשפז", "course": "אלגברה לינארית 2 - תשפז", "moodleCourseId": 4242, "lectures": 2, "cards": 2, "exportedAt": "2026-11-08T12:30:00.000Z" } ] }
```

`SumIT/<folder>/metadata.json`:
```json
{ "schema": 1, "app": "SumIT", "version": "1.0.37", "course": "אלגברה לינארית 2 - תשפז", "moodleCourseId": 4242,
  "exportedAt": "2026-11-08T12:30:00.000Z", "cardsFile": "cards.json",
  "lectures": [
    { "num": 1, "title": "מרחבים וקטוריים", "date": "2026-10-27", "file": "Lecture_01_מרחבים_וקטוריים.pdf", "sha256": "9f2c…",
      "summaryFile": null, "summarySha256": null, "cards": 0, "exportedAt": "2026-11-08T12:30:00.000Z" },
    { "num": 2, "title": "בסיס וממד", "date": null, "file": null, "sha256": null,
      "summaryFile": "Lecture_02_בסיס_וממד.md", "summarySha256": "41aa…", "cards": 2, "exportedAt": "2026-11-08T12:30:00.000Z" } ] }
```

`SumIT/<folder>/cards.json`:
```json
{ "schema": 1, "course": "אלגברה לינארית 2 - תשפז",
  "cards": [ { "num": 2, "key": "2-5d41402abc4b", "front": "מהו בסיס?", "back": "קבוצה בלתי תלויה שפורשת את המרחב", "tag": "בסיס" } ] }
```

Facts about the format:
- `moodleCourseId` is an int, or `null` for a course added by hand. It is the same id as `Course.moodleId` here (which uses `0` for none).
- `lectures[].num` (≥ 1) is the identity of a lecture. The title can change between exports.
- `date` is `YYYY-MM-DD` or `null`. `exportedAt` is ISO 8601 in UTC.
- A lecture has a PDF (`file`), a Markdown summary (`summaryFile`), or both. Each one has a sha256 (hex of the file bytes).
- `cards[].key` stays the same while the question of the card does, so use it to update a card instead of adding it twice.
- `front`/`back` can contain LaTeX between `$…$`.
- Every JSON file has `"schema": 1`. Ignore fields you do not know. If `schema` is greater than 1, do not import that file: show "עדכן את אפליקציית SumIT באייפד כדי לקרוא את הקבצים מהמק".
- Take file names only from `metadata.json`. Never build them yourself. Ignore files whose names start with `.` (the Mac writes through hidden temporary files).
- **The iPad never writes, renames or deletes anything in the `SumIT` folder.** That is the Mac's folder. (Later, the iPad will get a file of its own, `ipad.json`. It is not part of this task.)

### 1. Models (`Models.swift`)

Add the following. Every new property must have a default value, so the existing SwiftData store migrates on its own.
- `Course`: `var sumitFolder: String = ""`. This is the folder name from `index.json`, set once the course is linked.
- `Lecture`:
  - `var sumitNum: Int = 0`, the Mac lecture number (0 means not from the Mac);
  - `var sumitPdfFile: String = ""`;
  - `var sumitSummarySha: String = ""`, the sha of the Markdown that was imported last;
  - `var summaryFromMac: Bool = false`.
- `Flashcard`: `var sumitKey: String = ""`.

### 2. Connecting the folder (`SettingsView.swift`)

- Add a group "Mac app (iCloud)" next to the Moodle group, with:
  - **"Connect SumIT folder"**: `.fileImporter(allowedContentTypes: [.folder])`.
  - **"Import now"**.
  - The last import time.
  - **"Disconnect"**.
- After the student picks a folder, check that it contains `index.json`. If it does not, say: "בחר את התיקייה SumIT שבתוך iCloud Drive".
- Keep access across launches with a security-scoped bookmark (`url.bookmarkData()`), stored in `UserDefaults`. Resolve it with `URL(resolvingBookmarkData:bookmarkDataIsStale:)`, and save it again when it is stale. Wrap every access in `startAccessingSecurityScopedResource()` / `stopAccessingSecurityScopedResource()`.
- No iCloud entitlement and no ubiquity container are needed. The folder is the student's own iCloud Drive, opened through the picker.

### 3. Reading from iCloud (new file `MacImport.swift`)

- iCloud may not have downloaded a file to the iPad yet. Before reading a file:
  1. Check `URLResourceValues.ubiquitousItemDownloadingStatus`.
  2. If it is not `.current`, call `FileManager.default.startDownloadingUbiquitousItem(at:)`.
  3. Wait (poll every 0.5 s, up to about 30 s per file).
  4. If the file is still not there, skip it and report it.
- Read every file through `NSFileCoordinator().coordinate(readingItemAt:options:[], error:)`.
- Decode with `Decodable` structs for the three JSON files: `MacIndex`, `MacMetadata`, `MacCards`. Optional fields must be optional, and unknown fields are ignored.

### 4. Import logic (`MacImport.swift`)

Write it as a `@MainActor` type that takes a `ModelContext`, with the decoding and matching in plain functions that can be tested without files. For every course in `index.json`:

1. **Find the course.**
   1. A `Course` whose `sumitFolder` equals `folder`.
   2. Otherwise, when `moodleCourseId` is not null, the `Course` whose `moodleId` equals it.
   3. Otherwise, by name. Compare after trimming, collapsing whitespace and removing a trailing ` - <semester>` (for example ` - תשפז`). A match is equal names, or one name containing the other.
   4. Otherwise, create `Course(name: course, moodleId: moodleCourseId ?? 0)`.

   Then set `sumitFolder`. Never change `moodleId` of a course that already has one.
2. **Find each lecture** in `metadata.json`.
   1. The lecture of the course with `sumitNum == num`.
   2. Otherwise, one with `sumitNum == 0` and the same title (trimmed).
   3. Otherwise, a new `Lecture`.

   Set `sumitNum` and `title` (when the Mac title is not empty), and set `date` from `date` when there is one (keep the existing date otherwise).
3. **Summary.** When `summaryFile` is not null and `summarySha256 != lecture.sumitSummarySha`, read the Markdown. Then:
   - If `lecture.summary` is empty or `summaryFromMac` is true: put the Markdown into `lecture.summary`, and set `summaryFromMac = true` and `sumitSummarySha`.
   - Otherwise (the student generated a summary on the iPad): do not overwrite it. Add the Markdown to `lecture.material` under a heading `[סיכום מהמק]`, replacing an earlier `[סיכום מהמק]` block if there is one. Set `sumitSummarySha`.
4. **PDF.** Set `sumitPdfFile = file`. Do not copy the PDF into the app.
5. **Cards** (when `cardsFile` is not null): for each card in `cards.json`, find the lecture by `num`.
   - Find a `Flashcard` of that lecture with `sumitKey == key`.
   - If there is one, update `question`/`answer` only, and **keep `stage` and `dueDate`**.
   - If there is none, add `Flashcard(question: front, answer: back)` with `sumitKey = key`.
   - Never delete a card that the student created on the iPad (`sumitKey == ""`). Delete a card from the Mac (`sumitKey != ""`) only if its key is no longer in `cards.json` for that lecture **and** its `stage == 0`.
6. Skip a course whose `exportedAt` is the same as at the last import (store it per folder in `UserDefaults`), unless the student pressed "Import now".
7. Save the context once per course. When the import finishes, report: "יובאו X הרצאות ו-Y כרטיסים מהמק" (only lectures and cards that changed), plus any files that could not be downloaded.

### 5. When it runs

- On "Import now".
- When the app comes to the foreground (`scenePhase == .active`), if a folder is connected and at least 10 minutes have passed since the last import.

Only one import at a time.

### 6. UI

- `LectureView`: when `sumitPdfFile` is not empty, show an **"Open PDF"** button on the Summary tab. It opens the file from the connected folder:
  - download it first if needed (see step 3);
  - show it in a `PDFView` sheet (PDFKit is already imported);
  - also offer to open it in another app with `ShareLink`, for Notability or Goodnotes.
- In the Summary tab, show a small "מהמק" label when `summaryFromMac` is true.
- `CoursesView`: show a small Mac icon on a course whose `sumitFolder` is not empty.

### 7. Strings

The app is localized with `Localizable.xcstrings` (English keys, Hebrew translations). Add every new string there, with a Hebrew translation. The Hebrew texts in this prompt are the translations to use.

### 8. Tests (`SumITTests.swift`)

Use the in-memory `ModelContainer` that the tests already use. Add tests that:
- Decode the three JSON samples above, including `null` fields and an unknown extra field.
- Refuse `"schema": 2`.
- Match courses by `sumitFolder`, by `moodleCourseId`, and by name with a ` - תשפז` suffix, and create a course when nothing matches.
- Run the import twice and get no duplicate courses, lectures or cards.
- After the student reviewed a card (changed `stage`), import again: `stage` and `dueDate` are kept, and the answer is updated.
- Do not overwrite an iPad-generated summary. The Mac summary goes into `material` instead.
- Keep cards made on the iPad.

### Done when

The project builds for iPad. All tests pass. On a device, connecting the `iCloud Drive/SumIT` folder exported by the Mac app shows the course, its lectures, the Markdown summary, the cards, and an "Open PDF" button that works.
