#!/usr/bin/env python3
"""The demo workspace: a separate, resettable database of clearly labelled SYNTHETIC meetings.

It never touches the working database (backend/data). It lives in backend/demo-workspace/
(git-ignored) and is rebuilt from demo/workspace.sql, a text fixture of four synthetic meetings
processed earlier by the real pipeline (local Whisper, Ollama qwen3:8b) and reviewed through the
UI:

  1. Payments release planning: Rahul's refund API, Priya's regression tests waiting for it,
     Meera's release notes after SPEAKER_03 was confirmed, a "maybe someone should" suggestion
     left as a suggestion. Approved.
  2. Payments release follow-up: regression tests reassigned Priya -> Samiksha, due 26 Oct, on
     the same TASK-2; an ambiguous "cancel the old plan" answered (keep the task); the refund
     API reported done, so testing is no longer blocked. Approved.
  3. Payments status, code-mixed (Hindi/Kannada-English). Proposed, not approved; its proposal
     predates the current rules, so approval asks for a re-check first.
  4. Audio upload check (synthetic TTS, local Whisper). Open questions.

  backend/.venv/bin/python scripts/demo_workspace.py reset           # fresh copy (old one kept as a backup)
  backend/.venv/bin/python scripts/demo_workspace.py serve [--port 8000]
  backend/.venv/bin/python scripts/demo_workspace.py verify [--url http://127.0.0.1:8000]

`serve` reads the organiser token from .env like the normal server. `verify` is read-only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "demo" / "workspace.sql"
DEFAULT_DIR = ROOT / "backend" / "demo-workspace"
UPLOADS_TOKEN = "@UPLOADS@"
# The synthetic TTS clip of meeting 4 (made by scripts/make_tts_sample.sh; git-ignored).
AUDIO_SOURCES = [ROOT / "demo" / "audio" / "synthetic_tts_meeting.m4a"]


def reset(target: Path) -> None:
    if target.resolve() == (ROOT / "backend" / "data").resolve():
        sys.exit("refusing to overwrite the working database (backend/data)")
    if target.exists():
        backup = target.with_name(f"{target.name}.bak-{datetime.now():%Y%m%d-%H%M%S}")
        target.rename(backup)
        print(f"previous workspace kept at {backup}")
    uploads = target / "uploads"
    uploads.mkdir(parents=True)
    sql = FIXTURE.read_text(encoding="utf-8").replace(UPLOADS_TOKEN, str(uploads))
    db = sqlite3.connect(target / "app.db")
    db.executescript(sql)
    rows = db.execute("SELECT id, file_path FROM meeting WHERE file_path IS NOT NULL").fetchall()
    for mid, path in rows:
        src = next((p for p in AUDIO_SOURCES if p.exists()), None)
        if src is None:
            db.execute("UPDATE meeting SET file_path = NULL WHERE id = ?", (mid,))
            print(f"meeting {mid}: recording not available locally (run scripts/make_tts_sample.sh); its transcript is kept")
            continue
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, path)
    db.commit()
    n = {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("meeting", "task", "transcriptsegment", "changeset")}
    db.close()
    print(f"demo workspace ready at {target}: {n['meeting']} meetings, {n['task']} tasks, "
          f"{n['transcriptsegment']} transcript segments, {n['changeset']} proposals")


def serve(target: Path, port: int) -> None:
    if not (target / "app.db").exists():
        sys.exit(f"no workspace at {target}; run `reset` first")
    env = {**os.environ, "DATA_DIR": str(target)}
    os.chdir(ROOT / "backend")
    uvicorn = ROOT / "backend" / ".venv" / "bin" / "uvicorn"
    os.execve(str(uvicorn), [str(uvicorn), "app.main:app", "--host", "127.0.0.1", "--port", str(port)], env)


def _token() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("ORGANIZER_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("ORGANIZER_TOKEN not found in .env")


def verify(url: str) -> int:
    """Read-only checks that the running workspace tells the intended story."""
    token = _token()

    def get(path: str, raw: bool = False):
        req = urllib.request.Request(url + path, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read() if raw else json.loads(r.read())

    def ask(q: str) -> dict:
        req = urllib.request.Request(url + "/api/memory/query", method="POST", data=json.dumps({"question": q, "use_llm": False}).encode(),
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    checks: list[tuple[str, bool, str]] = []
    meetings = get("/api/meetings")
    tasks = {t["code"]: t for t in get("/api/tasks")}
    ids = {m["id"] for m in meetings}
    checks.append(("every meeting is labelled synthetic", all("synthetic" in m["title"].lower() for m in meetings), f"{len(meetings)} meetings"))
    titles = [t["title"].lower() for t in tasks.values()]
    checks.append(("no duplicate tasks", len(titles) == len(set(titles)), ", ".join(sorted(tasks))))
    checks.append(("every task comes from a stored meeting", all(t["origin_meeting_id"] in ids for t in tasks.values()), ""))
    t2 = get("/api/tasks/TASK-2") if "TASK-2" in tasks else None
    checks.append(("TASK-2 reassigned Priya -> Samiksha on the same task",
                   bool(t2) and [r["snapshot"]["owner"] for r in t2["revisions"]] == ["Priya", "Samiksha"], ""))
    checks.append(("TASK-2 due 26 Oct and not blocked (TASK-1 done)",
                   bool(t2) and t2["due_date"] == "2026-10-26" and not t2["is_blocked"] and tasks.get("TASK-1", {}).get("status") == "done", ""))
    checks.append(("only meetings 1 and 2 are approved",
                   sorted(m["id"] for m in meetings if (m["change_set"] or {}).get("state") == "APPLIED") == [1, 2], ""))
    a = ask("Who owns the regression tests?")
    checks.append(("Ask: regression tests owner from the records", a["mode"] == "task_records" and "Samiksha" in a["answer"], a["answer"][:80]))
    a = ask("When is the release notes task due?")
    checks.append(("Ask: release notes due date from the records", a["mode"] == "task_records" and "23 Oct" in a["answer"], a["answer"][:80]))
    for m in meetings:
        try:
            pdf = get(f"/api/meetings/{m['id']}/report.pdf", raw=True)
            ok = pdf[:5] == b"%PDF-"
        except urllib.error.HTTPError as exc:
            ok, pdf = False, str(exc).encode()
        checks.append((f"report for meeting {m['id']}", ok, f"{len(pdf)} bytes"))
    width = max(len(c[0]) for c in checks)
    for name, ok, note in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {note}")
    failed = sum(not ok for _, ok, _ in checks)
    print(f"{len(checks) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("reset", "serve"):
        p = sub.add_parser(name)
        p.add_argument("--dir", type=Path, default=DEFAULT_DIR)
        if name == "serve":
            p.add_argument("--port", type=int, default=8000)
    p = sub.add_parser("verify")
    p.add_argument("--url", default="http://127.0.0.1:8000")
    args = ap.parse_args()
    if args.cmd == "reset":
        reset(args.dir)
    elif args.cmd == "serve":
        serve(args.dir, args.port)
    else:
        t0 = time.perf_counter()
        code = verify(args.url.rstrip("/"))
        print(f"({time.perf_counter() - t0:.1f} s)")
        sys.exit(code)
