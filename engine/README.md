# SumIT study engine

The method and helper scripts SumIT's AI follows to turn a course's weekly material (lecture decks, exercise sheets,
solutions, past exams; PDFs, including handwritten ones) into **exam-focused study material**:

- **A study page per lecture**, built *from the lecturer's own worked solutions*: every formula explained inside its topic section (with the questions that use it), a "must know / skip" list based on what the exercises actually use, explanations that fill the gaps the slides leave, a question-pattern table (how to recognise a question, where to start, the trap), errata found in the official solutions, and a final "use in exercises" section with a solving hint per exercise (full solution hidden behind it), with per-question "solved" checkboxes.
- **Exercise PDFs with red pointers** (when scripts can run): next to every question, a margin note saying where the hint for it is and which of the lecturer's formulas it needs. Pointers only, never answers.

Hebrew-first (RTL), but works for any language. The app installs this folder for the AI by itself; nothing to set up.

## Layout

```
METHOD.md                        workflow and rules the AI follows
scripts/render.py                PDF pages to PNG + text dump (to read slides and handwriting)
scripts/locate.py                y-coordinates of question headers in an exercise PDF
scripts/assemble.py              page shell + body to study page
scripts/annotate.py              red pointer margin + links on exercise PDFs (config-driven)
scripts/checklinks.py            verify page links and that every lecturer formula is used by a hint
templates/page_shell.html        shared CSS, KaTeX, dark mode, progress checkboxes
templates/body_skeleton.html     section structure for a lecture page
templates/pointers_config_example.py
templates/course_log_template.md
```