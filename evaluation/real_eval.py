#!/usr/bin/env python3
"""Official PS 5.3 evaluation on REAL, consented meetings (not the synthetic fixtures).

Each meeting has a private folder (git-ignored: evaluation/private/<name>/):
  reference_transcript.json  human-corrected transcript
      {"segments": [{"speaker": "Asha", "start": 0.0, "end": 4.2, "text": "..."}]}
  reference_actions.json     human-annotated actions, written BEFORE looking at system output
      [{"id": "A1", "title": "...", "owner": "Asha" | null, "due_date": "YYYY-MM-DD" | null,
        "match_keywords": [["refund"], ["api"]]}]
  ratings.json               human summary ratings (1-5)
      [{"rater_role": "team member, not the organiser", "factuality": 4, "coverage": 3, "clarity": 5, "notes": ""}]
  meeting.json               {"meeting_id": <id in the app DB>, "code_mixed": true, "languages": ["kn", "en"]}

  backend/.venv/bin/python evaluation/real_eval.py report evaluation/private/meeting_a [more folders...]

Metrics (definitions fixed in docs/evaluation.md):
  WER = (S + D + I) / N over normalised words of the whole meeting.
  Action precision/recall: a system action matches a reference action when every
    keyword group matches its title (as in the fixture rubric); strict matches also
    need the same owner and, if annotated, the same due date.
  Speaker attribution accuracy: share of reference speech time whose hypothesis
    speaker label maps to the right person, after the best one-to-one mapping of
    diarization labels to reference speakers (greedy by overlap time).
Nothing is reported for a meeting whose annotation files are missing.
"""

from __future__ import annotations

import json

import sqlite3
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evaluation"))
from scoring import keys_match  # noqa: E402

DB = ROOT / "backend" / "data" / "app.db"


# ---------------------------------------------------------------------------
# WER
# ---------------------------------------------------------------------------

def normalise_words(text: str) -> list[str]:
    """Lowercase, Unicode NFC, drop punctuation, keep every script's letters/digits.
    Mixed-script policy: words are compared as written. The reference MUST be written
    in the same script convention the STT mode produces (e.g. Sarvam `codemix` keeps
    English words in Latin script); transliteration differences are not forgiven,
    which is why the policy is to annotate in the STT output convention."""
    t = unicodedata.normalize("NFC", text.lower())
    # Keep letters, digits AND combining marks (category M): Indic vowel signs such as
    # the ೇ in ಆದಮೇಲೆ are marks, which a plain \w regex would split off.
    t = "".join(ch if unicodedata.category(ch)[0] in "LNM" or ch == "'" else " " for ch in t)
    return [w.strip("'") for w in t.split() if w.strip("'")]


def wer_counts(ref: list[str], hyp: list[str]) -> dict:
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]))
    i, j, s, dl, ins = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            s += ref[i - 1] != hyp[j - 1]
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dl, i = dl + 1, i - 1
        else:
            ins, j = ins + 1, j - 1
    return {"substitutions": s, "deletions": dl, "insertions": ins, "reference_words": n,
            "wer": round((s + dl + ins) / n, 4) if n else None}


# ---------------------------------------------------------------------------
# Speaker attribution
# ---------------------------------------------------------------------------

def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def speaker_accuracy(ref: list[dict], hyp: list[dict]) -> dict:
    """ref/hyp: [{"speaker", "start", "end"}]. Greedy one-to-one label mapping by overlap."""
    ov: dict[tuple[str, str], float] = defaultdict(float)
    total = 0.0
    for r in ref:
        total += max(0.0, r["end"] - r["start"])
        for h in hyp:
            if h.get("end") is None:
                continue
            ov[(h["speaker"], r["speaker"])] += _overlap(r["start"], r["end"], h["start"], h["end"])
    mapping, used_h, used_r = {}, set(), set()
    for (h, r), t in sorted(ov.items(), key=lambda kv: -kv[1]):
        if h in used_h or r in used_r or t <= 0:
            continue
        mapping[h] = r
        used_h.add(h)
        used_r.add(r)
    correct = sum(t for (h, r), t in ov.items() if mapping.get(h) == r)
    return {"accuracy": round(correct / total, 4) if total else None, "reference_seconds": round(total, 1),
            "label_mapping": mapping}


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def action_scores(ref_actions: list[dict], sys_actions: list[dict]) -> dict:
    used: set[int] = set()
    lenient = strict = 0
    detail = []
    for ra in ref_actions:
        hit = next((i for i, sa in enumerate(sys_actions)
                    if i not in used and keys_match(sa["title"], {"groups": ra["match_keywords"]})), None)
        if hit is None:
            detail.append({"reference": ra["id"], "result": "missed"})
            continue
        used.add(hit)
        lenient += 1
        sa = sys_actions[hit]
        ok_owner = (sa.get("owner") or "").lower() == (ra.get("owner") or "").lower()
        ok_due = not ra.get("due_date") or sa.get("due_date") == ra["due_date"]
        strict += ok_owner and ok_due
        detail.append({"reference": ra["id"], "system": sa["title"], "owner_ok": ok_owner, "due_ok": ok_due})
    fp = [sa["title"] for i, sa in enumerate(sys_actions) if i not in used]

    def prf(tp: int) -> dict:
        p = tp / len(sys_actions) if sys_actions else 0.0
        r = tp / len(ref_actions) if ref_actions else 0.0
        return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(2 * p * r / (p + r), 3) if p + r else 0.0}

    return {"reference_actions": len(ref_actions), "system_actions": len(sys_actions),
            "lenient": prf(lenient), "strict": prf(strict), "unmatched_system_actions": fp, "detail": detail}


def system_outputs(meeting_id: int) -> tuple[list[dict], list[dict]]:
    """Hypothesis transcript segments and the proposed (pre-approval) actions for a meeting."""
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    segs = [{"speaker": r["speaker_label"], "start": r["start_seconds"], "end": r["end_seconds"], "text": r["text"]}
            for r in con.execute("SELECT * FROM transcriptsegment WHERE meeting_id=? ORDER BY order_index", (meeting_id,))]
    row = con.execute("SELECT base_result FROM changeset WHERE meeting_id=? ORDER BY id LIMIT 1", (meeting_id,)).fetchone()
    actions = []
    if row and row["base_result"]:
        for it in json.loads(row["base_result"])["items"]:
            if it["state"] in ("proposed", "needs_clarification"):
                actions.append({"title": it["title"], "owner": it["owner"], "due_date": it["deadline"]["date"]})
    return segs, actions


def evaluate_folder(folder: Path) -> dict | None:
    need = ["meeting.json", "reference_transcript.json", "reference_actions.json"]
    missing = [n for n in need if not (folder / n).exists()]
    if missing:
        return {"meeting": folder.name, "skipped": f"missing {missing}"}
    meta = json.loads((folder / "meeting.json").read_text())
    ref_t = json.loads((folder / "reference_transcript.json").read_text())["segments"]
    ref_a = json.loads((folder / "reference_actions.json").read_text())
    hyp_segs, sys_actions = system_outputs(int(meta["meeting_id"]))
    out = {"meeting": folder.name, "meeting_id": meta["meeting_id"], "code_mixed": meta.get("code_mixed"),
           "languages": meta.get("languages"),
           "wer": wer_counts(normalise_words(" ".join(s["text"] for s in ref_t)),
                             normalise_words(" ".join(s["text"] for s in hyp_segs))),
           "speakers": speaker_accuracy(ref_t, hyp_segs),
           "actions": action_scores(ref_a, sys_actions)}
    if (folder / "ratings.json").exists():
        ratings = json.loads((folder / "ratings.json").read_text())
        out["summary_ratings"] = {k: round(sum(r[k] for r in ratings) / len(ratings), 2)
                                  for k in ("factuality", "coverage", "clarity")} | {
            "raters": [r["rater_role"] for r in ratings]}
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] != "report":
        print(__doc__)
        return 2
    results = [evaluate_folder(Path(p)) for p in argv[1:]]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ROOT / "evaluation" / "results" / f"{stamp}_real_meetings.json"
    out.write_text(json.dumps({"generated_at": stamp, "meetings": results}, indent=2))
    print(json.dumps(results, indent=2))
    print(f"wrote {out} (contains no transcript text; review before committing)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
