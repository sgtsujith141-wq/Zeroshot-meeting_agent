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

  backend/.venv/bin/python evaluation/real_eval.py init evaluation/private/meeting_a --meeting-id 7
  backend/.venv/bin/python evaluation/real_eval.py export evaluation/private/meeting_a
  backend/.venv/bin/python evaluation/real_eval.py report evaluation/private/meeting_a [more folders...]

Metrics (definitions fixed in docs/evaluation.md):
  WER = (S + D + I) / N over normalised words of the whole meeting.
  Action precision/recall: a system action matches a reference action when every
    keyword group matches its title (as in the fixture rubric); strict matches also
    need the same owner and, if annotated, the same due date.
  Speaker attribution accuracy: share of reference speech time whose hypothesis
    speaker label maps to the right person, after the best one-to-one mapping of
    diarization labels to reference speakers (greedy by overlap time).
Every metric without its annotation file is reported as NOT MEASURED.
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


NM = "NOT MEASURED"


def system_outputs(meeting_id: int) -> dict:
    """The system's ACTUAL output for a meeting: transcript segments, the FIRST (pre-edit)
    proposal's new actions (rubric v2: completions/cancellations are not new actions),
    and minutes decisions. Organiser edits are never credited to the system."""
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    m = con.execute("SELECT * FROM meeting WHERE id=?", (meeting_id,)).fetchone()
    if m is None:
        raise SystemExit(f"meeting {meeting_id} not found in {DB}")
    segs = [{"seg_key": r["seg_key"], "speaker": r["speaker_label"], "start": r["start_seconds"],
             "end": r["end_seconds"], "text": r["text"], "source_type": r["source_type"]}
            for r in con.execute("SELECT * FROM transcriptsegment WHERE meeting_id=? ORDER BY order_index", (meeting_id,))]
    row = con.execute("SELECT base_result FROM changeset WHERE meeting_id=? ORDER BY id LIMIT 1", (meeting_id,)).fetchone()
    actions = []
    if row and row["base_result"]:
        for it in json.loads(row["base_result"])["items"]:
            if it["state"] in ("proposed", "needs_clarification") and it["operation"] not in ("complete", "cancel"):
                actions.append({"title": it["title"], "owner": it["owner"], "due_date": it["deadline"]["date"],
                                "depends_on": [d["title"] for d in it["depends_on"]], "state": it["state"],
                                "evidence": it["evidence_segment_ids"]})
    decisions = [{"text": r["text"], "rationale": r["rationale"], "evidence": json.loads(r["evidence_segment_ids"] or "[]")}
                 for r in con.execute("SELECT * FROM decision WHERE meeting_id=?", (meeting_id,))]
    minutes = json.loads(m["minutes"] or "{}")
    return {"meeting_id": meeting_id, "title": m["title"], "stt_provider": m["stt_provider"], "stt_model": m["stt_model"],
            "segments": segs, "actions": actions, "decisions": decisions, "summary": minutes.get("summary")}


def decision_scores(ref: list[dict], sys_d: list[dict]) -> dict:
    used, tp, detail = set(), 0, []
    for rd in ref:
        hit = next((i for i, d in enumerate(sys_d) if i not in used
                    and keys_match(d["text"], {"groups": rd["match_keywords"]})), None)
        detail.append({"reference": rd["id"], "matched": hit is not None})
        if hit is not None:
            used.add(hit)
            tp += 1
    p = tp / len(sys_d) if sys_d else 0.0
    r = tp / len(ref) if ref else 0.0
    return {"reference_decisions": len(ref), "system_decisions": len(sys_d), "precision": round(p, 3),
            "recall": round(r, 3), "f1": round(2 * p * r / (p + r), 3) if p + r else 0.0, "detail": detail}


def dependency_scores(ref_actions: list[dict], sys_actions: list[dict], action_detail: list[dict]) -> dict | str:
    by_id = {a["id"]: a for a in ref_actions}
    wanted = [a for a in ref_actions if a.get("depends_on")]
    if not wanted:
        return NM + " (no annotated dependencies)"
    sys_by_title = {a["title"]: a for a in sys_actions}
    ok = 0
    for a in wanted:
        det = next((d for d in action_detail if d["reference"] == a["id"] and d.get("system")), None)
        pre = by_id.get(a["depends_on"])
        if det and pre and any(keys_match(t, {"groups": pre["match_keywords"]})
                               for t in sys_by_title[det["system"]]["depends_on"]):
            ok += 1
    return {"annotated": len(wanted), "correct": ok}


def _load(folder: Path, name: str):  # noqa: ANN202
    f = folder / name
    return json.loads(f.read_text()) if f.exists() else None


def evaluate_folder(folder: Path) -> dict:
    meta = _load(folder, "meeting.json")
    if not meta or meta.get("meeting_id") is None:
        return {"meeting": folder.name, "status": NM + ": meeting.json with meeting_id is missing"}
    out_sys = system_outputs(int(meta["meeting_id"]))
    ref_t, ref_a = _load(folder, "reference_transcript.json"), _load(folder, "reference_actions.json")
    ref_d, ratings = _load(folder, "reference_decisions.json"), _load(folder, "ratings.json")
    res = {"meeting": folder.name, "meeting_id": meta["meeting_id"], "code_mixed": meta.get("code_mixed"),
           "languages": meta.get("languages"), "real_recording": meta.get("real_recording"),
           "stt": f"{out_sys['stt_provider']}/{out_sys['stt_model']}" if out_sys["stt_provider"] else NM + " (no audio transcribed)"}
    if ref_t and ref_t.get("segments") and out_sys["stt_provider"]:
        res["wer"] = wer_counts(normalise_words(" ".join(x["text"] for x in ref_t["segments"])),
                                normalise_words(" ".join(x["text"] for x in out_sys["segments"])))
        res["speaker_attribution"] = speaker_accuracy(ref_t["segments"], out_sys["segments"])
    else:
        res["wer"] = res["speaker_attribution"] = NM + (" (no reference transcript)" if not ref_t or not ref_t.get("segments")
                                                        else " (transcript was imported, not transcribed)")
    if ref_a is not None:
        res["actions"] = action_scores(ref_a, out_sys["actions"])
        res["dependencies"] = dependency_scores(ref_a, out_sys["actions"], res["actions"]["detail"])
    else:
        res["actions"] = res["dependencies"] = NM + " (no reference_actions.json)"
    res["decisions"] = decision_scores(ref_d, out_sys["decisions"]) if ref_d is not None else NM + " (no reference_decisions.json)"
    if ratings:
        res["summary_ratings"] = {k: round(sum(r[k] for r in ratings) / len(ratings), 2)
                                  for k in ("factuality", "coverage", "clarity")} | {"raters": [r["rater_role"] for r in ratings]}
    else:
        res["summary_ratings"] = NM + " (no ratings.json)"
    return res


TEMPLATES = {
    "meeting.json": {"meeting_id": None, "real_recording": True, "code_mixed": False, "languages": ["en"],
                     "consent": "describe how consent was obtained (no names)"},
    "reference_transcript.json": {"_instructions": "Transcribe from the AUDIO yourself. Do not copy system_transcript.json. "
                                                   "English words in Latin script; Indic words in the script the STT mode outputs.",
                                  "segments": []},
    "reference_actions.json": [],
    "reference_decisions.json": [],
    "ratings.json": [],
}
README = """Private annotation folder (git-ignored). Fill in BEFORE looking at the system's actions:
1. meeting.json: meeting_id from the app; code_mixed true/false; languages.
2. reference_transcript.json: {"segments": [{"speaker": "Name", "start": 0.0, "end": 4.2, "text": "..."}]} from the audio.
3. reference_actions.json: [{"id": "A1", "title": "...", "owner": "Name"|null, "due_date": "YYYY-MM-DD"|null,
   "depends_on": "A0"|null, "match_keywords": [["word"], ["alt1", "alt2"]]}]
4. reference_decisions.json: [{"id": "D1", "text": "...", "rationale": "...", "match_keywords": [["word"]]}]
5. ratings.json: [{"rater_role": "...", "factuality": 1-5, "coverage": 1-5, "clarity": 1-5, "notes": ""}]
   Rate the summary in system_summary.txt (after running export). 5 = no error/omission, 3 = one notable
   omission or minor error, 1 = misleading. Raters should not be the organiser who reviewed it.
Then: backend/.venv/bin/python evaluation/real_eval.py export <this folder>   (saves the system's actual output)
      backend/.venv/bin/python evaluation/real_eval.py report evaluation/private/*
"""


def cmd_init(folder: Path, meeting_id: int | None) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name, body in TEMPLATES.items():
        f = folder / name
        if f.exists():
            continue  # never overwrite annotations
        if name == "meeting.json":
            body = {**body, "meeting_id": meeting_id}
        f.write_text(json.dumps(body, indent=2, ensure_ascii=False))
    (folder / "README.txt").write_text(README)
    print(f"initialised {folder} (existing files kept)")


def cmd_export(folder: Path) -> None:
    meta = _load(folder, "meeting.json")
    out = system_outputs(int(meta["meeting_id"]))
    (folder / "system_transcript.json").write_text(json.dumps({"segments": out["segments"]}, indent=2, ensure_ascii=False))
    (folder / "system_actions.json").write_text(json.dumps(out["actions"], indent=2, ensure_ascii=False))
    (folder / "system_decisions.json").write_text(json.dumps(out["decisions"], indent=2, ensure_ascii=False))
    (folder / "system_summary.txt").write_text(out["summary"] or "")
    print(f"exported system output of meeting {meta['meeting_id']} to {folder}/system_*")


def to_markdown(results: list[dict]) -> str:
    real = [r for r in results if r.get("real_recording")]
    lines = ["# Real-meeting evaluation report", "",
             f"- Real recordings evaluated: {len(real)} (required: 3)",
             f"- Code-mixed real recordings: {sum(1 for r in real if r.get('code_mixed'))} (required: 1)", "",
             "| meeting | STT | WER | speaker attribution | actions P / R (strict) | decisions P / R | summary (fact/cov/clar) |",
             "|---|---|---|---|---|---|---|"]
    for r in results:
        if "status" in r:
            lines.append(f"| {r['meeting']} | {r['status']} | | | | | |")
            continue
        w = r["wer"]["wer"] if isinstance(r["wer"], dict) else r["wer"]
        sp = r["speaker_attribution"]["accuracy"] if isinstance(r["speaker_attribution"], dict) else r["speaker_attribution"]
        a = (f"{r['actions']['strict']['precision']} / {r['actions']['strict']['recall']}"
             if isinstance(r["actions"], dict) else r["actions"])
        d = f"{r['decisions']['precision']} / {r['decisions']['recall']}" if isinstance(r["decisions"], dict) else r["decisions"]
        s = (f"{r['summary_ratings']['factuality']} / {r['summary_ratings']['coverage']} / {r['summary_ratings']['clarity']}"
             if isinstance(r["summary_ratings"], dict) else r["summary_ratings"])
        lines.append(f"| {r['meeting']} | {r['stt']} | {w} | {sp} | {a} | {d} | {s} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("init", "export", "report"):
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    if cmd == "init":
        cmd_init(Path(rest[0]), int(rest[2]) if len(rest) > 2 and rest[1] == "--meeting-id" else None)
        return 0
    if cmd == "export":
        cmd_export(Path(rest[0]))
        return 0
    results = [evaluate_folder(Path(x)) for x in rest]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ROOT / "evaluation" / "results" / f"{stamp}_real_meetings"
    out.with_suffix(".json").write_text(json.dumps({"generated_at": stamp, "meetings": results}, indent=2, ensure_ascii=False))
    out.with_suffix(".md").write_text(to_markdown(results))
    print(to_markdown(results))
    print(f"wrote {out}.json/.md (metrics, label mapping and action titles; no transcript text). Review before committing.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
