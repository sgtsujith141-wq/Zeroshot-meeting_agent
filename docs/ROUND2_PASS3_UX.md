# Round 2, pass 3: UX and visual polish

Goal: a judge understands each screen at once. The limestone, forest graphite and vermilion
identity was kept; no new palette. Every change below came from a screenshot of the running
demo workspace (http://127.0.0.1:8000) at 1440 and 390 px, and was checked again after the fix.

## Findings and fixes

| # | Screen | Finding (from the screenshot) | Fix |
|---|---|---|---|
| U1 | New meeting | The recorder did not read as the centrepiece: a small Record button under an empty line | Large round Record / Stop / Play controls with the label beside them; a live ring while recording; one line saying nothing leaves the browser until *Transcribe recording*. Accessible names unchanged |
| U2 | New meeting, 390 px | Three stacked mode cards pushed the recorder below the first screen | The three modes are one compact row on phones (icon and label); the description returns from 640 px |
| U3 | Meeting results | "Review and approve tasks" appeared twice as equally strong primary buttons (header and side card) | The header keeps the primary button; the side card has a quiet "Open the review" |
| U4 | Meeting results | Five header buttons | *Preview report* moved into More; *Download meeting report* stays visible |
| U5 | Approvals | Before → after was only weight and colour | The old value is struck through, a vermilion arrow, the new value highlighted; screen readers still hear "changes to" |
| U6 | Processing | With the minutes now written alongside the extraction, the last stage read "Done in 0:00" | Shows "Done" when the stage finished with the previous one |

Checked and left as they are: Overview (attention, current work, history in that order;
synthetic tags; phone layout), Tasks (compact rows, status dots, dependency column), Ask AI
(input, answer, sources, timing), Follow-ups, Diagnostics, the intro.

## PDF report

Re-rendered from the demo workspace and inspected page by page in Round 1 and again here
(`pdftoppm`): header with approval and SYNTHETIC tags, summary, discussion, decisions with
rationale or "No rationale was stated", action register, changes to previous commitments
(Owner Priya → Samiksha, Due date No date → Mon 26 Oct 2026, approved Yes), outstanding
questions, follow-up, transcript appendix, running header and "Page N of M". Devanagari is
shaped (Kohinoor Devanagari), Kannada through Noto Sans Kannada; no clipped tables. No change
was needed in this pass.

## Verification

| Command | Result |
|---|---|
| `npx playwright test e2e/flows/final-ui.spec.ts e2e/flows/a11y.spec.ts e2e/flows/mic-denied.spec.ts e2e/flows/live-audio.spec.ts e2e/flows/approvals.spec.ts e2e/flows/links.spec.ts` | 54 passed, 0 failed (4.1 min) |
| `SCREENS=1 VW=1440|1024|390 npx playwright test e2e/screens.spec.ts` (overflow, controls outside the viewport) | 3 of 3 widths passed |
| axe WCAG 2.1 A/AA (in `a11y.spec.ts`), every route, both themes, drawers, dialogs, intro | included above |
