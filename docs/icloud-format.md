# iCloud Drive format (schema 1)

> המבנה שאפליקציית SumIT ל-macOS כותבת ל-iCloud Drive, ושאפליקציית SumIT לאייפד קוראת. הקוד: `macos/lib/modules/study-export.js` (`ICloudExport`). הבדיקות: `runStudyExportTests` ב-`macos/scripts/offline-tests.js`.

The Mac app writes this when the student presses "ייצא ל-iCloud / iPad" in the study track page. It is the contract between the Mac app and the iPad app.

## Folder

```
iCloud Drive/                                  (~/Library/Mobile Documents/com~apple~CloudDocs on the Mac)
└── SumIT/
    ├── index.json
    └── <course folder>/                       e.g. "אלגברה לינארית 2 - תשפז"
        ├── metadata.json
        ├── cards.json                         only when the course has cards
        ├── Lecture_01_מרחבים_וקטוריים.pdf      the summary PDF, when the lecture has one
        ├── Lecture_02_בסיס_וממד.md             the short summary in Markdown, when the lecture has one
        └── Lecture_01_מרחבים_וקטוריים_2026-11-08-1430.pdf   a file that was edited on the iPad, kept (see Overwrites)
```

## Rules

- **One writer per file.** The Mac writes every file above. The iPad never writes, renames or deletes them. Anything the iPad wants to tell the Mac goes into a file that only the iPad writes (reserved name: `SumIT/<course folder>/ipad.json`, not defined yet).
- **Atomic writes.** Each file is written to a hidden `.<name>.tmp` and renamed, so a reader never sees half a file. Readers should ignore names that start with `.`.
- **`schema`** is `1` in every JSON file. It goes up only for a change that an older reader cannot handle. New optional fields can be added without raising it, so readers must ignore fields they do not know. A reader that finds a higher schema than it knows should stop and ask the student to update the app.
- **Names.** Every file name is `Lecture_<NN>_<topic>` (or `Lecture_<NN>` with no title). `NN` is the lecture number, at least two digits. The topic is the lecture title: spaces become `_`, characters invalid in file names are removed, at most 60 characters, and Hebrew is kept. Readers should take names from `metadata.json` and never build them on their own.
- **Text** is UTF-8 JSON, pretty-printed. Dates are ISO 8601 (`exportedAt`, in UTC) or `YYYY-MM-DD` (`date`, local).

## `SumIT/index.json`

```json
{
  "schema": 1,
  "app": "SumIT",
  "version": "1.0.37",
  "updatedAt": "2026-11-08T12:30:00.000Z",
  "courses": [
    { "folder": "אלגברה לינארית 2 - תשפז", "course": "אלגברה לינארית 2 - תשפז", "moodleCourseId": 4242, "lectures": 2, "cards": 2, "exportedAt": "2026-11-08T12:30:00.000Z" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `courses[].folder` | string | The name of the course folder next to `index.json`. |
| `courses[].course` | string | The name of the course in the Mac app (often with the semester, e.g. ` - תשפז`). |
| `courses[].moodleCourseId` | int or null | The Moodle course id. `null` for a course added by hand. |
| `courses[].lectures`, `courses[].cards` | int | How many lectures and cards were exported. |

A course whose folder was deleted is removed from the list on the next export.

## `SumIT/<course>/metadata.json`

```json
{
  "schema": 1,
  "app": "SumIT",
  "version": "1.0.37",
  "course": "אלגברה לינארית 2 - תשפז",
  "moodleCourseId": 4242,
  "exportedAt": "2026-11-08T12:30:00.000Z",
  "cardsFile": "cards.json",
  "lectures": [
    { "num": 1, "title": "מרחבים וקטוריים", "date": "2026-10-27",
      "file": "Lecture_01_מרחבים_וקטוריים.pdf", "sha256": "9f2c…",
      "summaryFile": null, "summarySha256": null,
      "cards": 0, "exportedAt": "2026-11-08T12:30:00.000Z" },
    { "num": 2, "title": "בסיס וממד", "date": null,
      "file": null, "sha256": null,
      "summaryFile": "Lecture_02_בסיס_וממד.md", "summarySha256": "41aa…",
      "cards": 2, "exportedAt": "2026-11-08T12:30:00.000Z" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `moodleCourseId` | int or null | Same id as `Course.moodleId` on the iPad (which uses `0` for "none"). |
| `cardsFile` | string or null | `"cards.json"`, or `null` when the course has no cards. |
| `lectures[].num` | int ≥ 1 | The lecture number. **This is the identity of a lecture.** The title can change. |
| `lectures[].title` | string | Can be empty. |
| `lectures[].date` | `YYYY-MM-DD` or null | The lecture date, when the student entered one. |
| `lectures[].file`, `sha256` | string or null | The summary PDF and the sha256 (hex) of its bytes. |
| `lectures[].summaryFile`, `summarySha256` | string or null | The Markdown summary and its sha256. A lecture has at least one of `file` and `summaryFile`. |
| `lectures[].cards` | int | How many cards of this lecture are in `cards.json`. |
| `lectures[].exportedAt` | ISO date | When a file of this lecture last changed. It stays the same when an export finds nothing new. |

Use the sha256 to know whether a file changed since the last read. Only `exportedAt` of the whole file changes on every export.

## `SumIT/<course>/cards.json`

```json
{
  "schema": 1,
  "course": "אלגברה לינארית 2 - תשפז",
  "cards": [
    { "num": 2, "key": "2-5d41402abc4b", "front": "מהו בסיס?", "back": "קבוצה בלתי תלויה שפורשת את המרחב", "tag": "בסיס" }
  ]
}
```

| Field | Meaning |
|---|---|
| `num` | The lecture of the card. |
| `key` | `<num>-<first 12 hex characters of sha256(front)>`, where `front` has its whitespace collapsed and trimmed. It stays the same while the question does, so a reader updates a card and does not add it twice. If the question changes, the key changes too. |
| `front`, `back` | Question and answer. They can contain LaTeX between `$…$`. |
| `tag` | A 1 to 3 word topic. Can be empty. |

The file is rewritten only when its content changes. It is deleted when the course has no cards left.

## Overwrites

For each PDF and Markdown file, on every export:

| What is in the folder | What the Mac does |
|---|---|
| Nothing | Writes the file. |
| The same bytes | Nothing. |
| The bytes the Mac wrote last time (sha256 matches `metadata.json`) | Overwrites them with the new summary. |
| Something else (the student wrote on the file on the iPad) | Renames it to `<name>_<YYYY-MM-DD-HHmm>.<ext>` (and `-2`, `-3`… if needed), then writes the new summary. |
| The title of the lecture changed | Writes the new name, and deletes the old file only if its bytes are still the ones the Mac wrote. |

A lecture that has no summary any more keeps its line in `metadata.json` while one of its files is still in the folder.
