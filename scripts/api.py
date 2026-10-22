#!/usr/bin/env python3
"""Small CLI over the HTTP API (same endpoints the web UI uses).

  python scripts/api.py health
  python scripts/api.py smoke                      # live LLM smoke test
  python scripts/api.py ingest demo/synthetic_meeting_1_planning.json
  python scripts/api.py changeset <meeting_id>
  python scripts/api.py map <meeting_id> <speaker_label> <name>
  python scripts/api.py answer <changeset_id> "<item_key>|<kind>" <choice> [value]
  python scripts/api.py approve <changeset_id>
  python scripts/api.py tasks | agenda | reminders | notifications
  python scripts/api.py ask "who owns the regression tests?"

Reads ORGANIZER_TOKEN from the repo .env (never printed). API base: $API_BASE or http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent


def token() -> str:
    if os.getenv("ORGANIZER_TOKEN"):
        return os.environ["ORGANIZER_TOKEN"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("ORGANIZER_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("ORGANIZER_TOKEN not found (run scripts/setup_env.sh)")


BASE = os.getenv("API_BASE", "http://127.0.0.1:8000")
C = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {token()}"}, timeout=120)


def j(r: httpx.Response):
    if r.status_code >= 400:
        print(f"HTTP {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


def show_changeset(cs: dict) -> None:
    p = cs["proposal"]
    print(f"change set {cs['id']} (meeting {cs['meeting_id']}) state={cs['state']} version={cs['version']}")
    for it in p["items"]:
        dl = it["deadline"]
        before = f" before={it['before']}" if it.get("before") else ""
        print(f"  [{it['state']:<19}] {it['operation']:<7} {it['key']:<22} “{it['title']}” owner={it['owner']} "
              f"due={dl.get('date')} ({dl.get('raw')}) deps={[d['key'] for d in it['depends_on']]} "
              f"existing={it['existing_task_id']}{before}")
        for h in it["history"]:
            print(f"        · {h['type']}: {h['summary']} {h['segment_ids']}")
    for c in p["clarifications"]:
        flag = "deferred" if c.get("deferred") else ("answered" if c.get("answer") else "OPEN")
        print(f"  Q {c['id']} rank{c['rank']} {flag:<8} {c['kind']} items={c['item_keys']}: {c['question']}")
    for d in p.get("decisions_review", []):
        print(f"  decision: {d['text']} | reason: {d['rationale']} {d['evidence_segment_ids']}")
    for w in p["warnings"]:
        print(f"  warning: {w['kind']} {w['segment_ids']} {w['detail']}")
    for r in p["rejected_events"]:
        print(f"  rejected event: {r['reason']}")


def main(argv: list[str]) -> None:
    cmd, args = argv[0], argv[1:]
    if cmd == "health":
        print(json.dumps(j(C.get("/api/health")), indent=2))
    elif cmd == "smoke":
        print(json.dumps(j(C.post("/api/diagnostics/llm-smoke")), indent=2))
    elif cmd == "ingest":
        spec = json.loads(Path(args[0]).read_text())
        m = j(C.post("/api/meetings", json={"title": spec["title"], "scheduled_at": spec["scheduled_at"],
                                            "timezone": spec.get("timezone", "Asia/Kolkata"),
                                            "consent_confirmed": True,
                                            "consent_statement": "Synthetic transcript; no real participants."}))
        body = json.dumps({"segments": spec["segments"]}).encode()
        j(C.post(f"/api/meetings/{m['id']}/upload", files={"file": ("transcript.json", body, "application/json")}))
        t0 = time.time()
        while True:
            d = j(C.get(f"/api/meetings/{m['id']}"))
            if d["processing_status"] in ("ready_for_review", "failed"):
                break
            time.sleep(3)
        print(f"meeting {m['id']} -> {d['processing_status']} in {time.time() - t0:.0f}s {d['processing_error'] or ''}")
        for r in d["llm_runs"]:
            print(f"  llm {r['purpose']}: {r['provider']}/{r['model']} {r['latency_ms']} ms attempts={r['attempts']} "
                  f"error={r['error']}")
        if d["processing_status"] == "ready_for_review":
            show_changeset(j(C.get(f"/api/meetings/{m['id']}/changeset")))
    elif cmd == "changeset":
        show_changeset(j(C.get(f"/api/meetings/{args[0]}/changeset")))
    elif cmd == "map":
        print(j(C.put(f"/api/meetings/{args[0]}/participants/{args[1]}", json={"display_name": args[2]})))
        show_changeset(j(C.get(f"/api/meetings/{args[0]}/changeset")))
    elif cmd == "answer":
        ans = {"choice": args[2], "value": args[3] if len(args) > 3 else None}
        show_changeset(j(C.patch(f"/api/changesets/{args[0]}", json={"answers": {args[1]: ans}})))
    elif cmd == "edit":
        show_changeset(j(C.patch(f"/api/changesets/{args[0]}", json={"items": {args[1]: json.loads(args[2])}})))
    elif cmd == "approve":
        cs = j(C.get(f"/api/changesets/{args[0]}"))
        print(json.dumps(j(C.post(f"/api/changesets/{args[0]}/approve",
                                  json={"proposal_hash": cs["proposal_hash"]}))["result"], indent=2))
    elif cmd == "tasks":
        for t in j(C.get("/api/tasks")):
            print(f"  {t['code']:<8} [{t['status']:<11}] “{t['title']}” owner={t['owner']} due={t['due_date']} "
                  f"rev={t['revision']} blocked={t['is_blocked']} prereqs={[p['code'] for p in t['prerequisites']]}")
    elif cmd == "agenda":
        print(j(C.get("/api/agenda"))["markdown"])
    elif cmd in ("reminders", "notifications"):
        print(json.dumps(j(C.get(f"/api/{cmd}")), indent=2))
    elif cmd == "ask":
        r = j(C.post("/api/memory/query", json={"question": args[0]}))
        print(f"[{r['mode']}] found={r['found']}: {r['answer']}")
        for p in r["citations"]:
            print(f"  cite {p['passage_id']} {p['doc_type']} m{p['meeting_id']} {p.get('seg_key', '')} "
                  f"{p.get('speaker', '')}: {p['text'][:120]}")
        for t in r["current_state"]:
            print(f"  current: {t['code']} {t['title']} owner={t['owner']} status={t['status']} due={t['due_date']}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:] or ["help"])
