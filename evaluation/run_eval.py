#!/usr/bin/env python3
"""Baseline vs candidate on the SYNTHETIC engineering fixtures.

  backend/.venv/bin/python evaluation/run_eval.py --provider ollama --model qwen3:8b
  backend/.venv/bin/python evaluation/run_eval.py --replay evaluation/results/<run>.json

Both pipelines use the same model, temperature, seed, rules text and evidence
validation. Every raw model response is saved so the run can be re-scored
(--replay) without new model calls; replayed reports are labelled as such.

These fixtures are NOT the official three-real-meeting evaluation.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "evaluation"))

from app.config import get_settings  # noqa: E402
from app.services.identity import SpeakerDirectory  # noqa: E402
from app.services.llm import LLMError, get_llm  # noqa: E402
from app.services.llm_schemas import BaselineOut, InterpretationOut  # noqa: E402
from app.services.pipelines import (  # noqa: E402
    baseline_clarifications, baseline_items, candidate_items, run_baseline, run_candidate,
)
from app.services.prompts import BASELINE_SYSTEM, CANDIDATE_SYSTEM, PROMPT_VERSION  # noqa: E402
from app.services.reconcile import (  # noqa: E402
    LedgerTask, ReconcileContext, Segment, reconcile,
)
from scoring import aggregate, score_case  # noqa: E402

DEFAULT_FIXTURES = ROOT / "evaluation" / "fixtures" / "PS53_commitment_test_fixtures.json"
DEFAULT_KEYS = ROOT / "evaluation" / "annotations" / "fixture_match_keys.json"
PIPELINES = ("baseline", "baseline_det", "candidate")


def load_case(fx: dict):
    meeting_dt = datetime.fromisoformat(fx["meeting_date"])
    segments = [Segment(id=s["id"], speaker=s["speaker"], start=float(s["start_seconds"]), text=s["text"])
                for s in fx["segments"]]
    ledger = [LedgerTask(task_id=t["task_id"], title=t["title"], owner=t.get("owner"),
                         due_date=t.get("due_date"), status=t.get("status", "approved"))
              for t in fx.get("prior_approved_tasks", [])]
    return meeting_dt, segments, ledger, SpeakerDirectory()


def evaluate_case(fx: dict, spec: dict, llm, recorded: dict | None) -> dict:
    meeting_dt, segments, ledger, directory = load_case(fx)
    tz = fx.get("meeting_timezone", "Asia/Kolkata")
    out: dict = {"id": fx["id"], "scenario": fx["scenario"]}

    # ---- baseline (one call; the deterministic-normalisation ablation reuses it)
    try:
        if recorded:
            b_out = BaselineOut.model_validate(recorded["baseline"]["raw"])
            b_call = recorded["baseline"]["call"]
        else:
            br = run_baseline(llm, meeting_dt, tz, segments, ledger, directory)
            b_out, b_call = br.output, br.call.to_dict()
        for name, det in (("baseline", False), ("baseline_det", True)):
            items, warns = baseline_items(b_out, segments, ledger, meeting_dt, directory, det)
            clar = baseline_clarifications(items)
            out[name] = {"items": items, "clarifications": clar, "warnings": warns,
                         "score": score_case(fx, spec, items, clar)}
        out["baseline"]["raw"] = b_out.model_dump(mode="json")
        out["baseline"]["call"] = b_call
    except LLMError as exc:
        for name in ("baseline", "baseline_det"):
            out[name] = {"error": str(exc), "items": [], "clarifications": [],
                         "score": score_case(fx, spec, [], [])}
        out["baseline"]["call"] = getattr(exc, "call", None) and exc.call.to_dict()

    # ---- candidate
    try:
        if recorded:
            interp = InterpretationOut.model_validate(recorded["candidate"]["raw"])
            ctx = ReconcileContext(meeting_date=meeting_dt.date(), directory=directory, ledger=ledger)
            result, c_call = reconcile(segments, interp.events, ctx), recorded["candidate"]["call"]
        else:
            cr = run_candidate(llm, meeting_dt, tz, segments, ledger, directory)
            interp, result, c_call = cr.interpretation, cr.result, cr.call.to_dict()
        items = candidate_items(result)
        clar = [c["question"] for c in result.clarifications if not c.get("deferred")]
        out["candidate"] = {"items": items, "clarifications": clar,
                            "clarification_detail": result.clarifications,
                            "warnings": result.warnings, "rejected_events": result.rejected_events,
                            "raw": interp.model_dump(mode="json"), "call": c_call,
                            "reconciled": result.to_dict(),
                            "score": score_case(fx, spec, items, clar)}
    except LLMError as exc:
        out["candidate"] = {"error": str(exc), "items": [], "clarifications": [],
                            "call": getattr(exc, "call", None) and exc.call.to_dict(),
                            "score": score_case(fx, spec, [], [])}
    return out


def render_markdown(report: dict) -> str:
    m = report["meta"]
    lines = [
        f"# Baseline vs candidate — synthetic fixtures ({m['run_id']})", "",
        "> SYNTHETIC ENGINEERING FIXTURES — not the official three-real-meeting evaluation.", "",
        f"- Provider / model: **{m['provider']} / {m['model']}** (same for all pipelines)",
        f"- temperature={m['temperature']}, seed={m['seed']}, trials={m['trials']}, "
        f"prompt version={m.get('prompt_version', 'v1')}",
        f"- Mode: **{m['mode']}**" + (f" (raw responses from `{m['replayed_from']}`)" if m.get("replayed_from") else ""),
        f"- Started {m['started_at']}, wall time {m['wall_seconds']}s, host {m['host']}", "",
        "## Aggregate (micro-averaged over all cases and trials)", "",
        "| metric | " + " | ".join(PIPELINES) + " |", "|---|" + "---|" * len(PIPELINES),
    ]
    agg = report["aggregate"]
    rows = [
        ("strict precision", lambda a: a["strict"]["precision"]),
        ("strict recall", lambda a: a["strict"]["recall"]),
        ("strict F1", lambda a: a["strict"]["f1"]),
        ("lenient (title-only) F1", lambda a: a["lenient"]["f1"]),
        ("owner errors", lambda a: a["owner_errors"]),
        ("due-date errors", lambda a: a["due_errors"]),
        ("state errors", lambda a: a["state_errors"]),
        ("false-positive active items", lambda a: a["false_positives"]),
        ("dependencies correct", lambda a: a["dependencies"]),
        ("safety checks passed", lambda a: a["safety_checks_passed"]),
        ("clarifications on clean cases", lambda a: a["clarifications_on_clean_cases"]),
        ("cases fully correct", lambda a: f"{a['cases_fully_correct']}/{a['cases']}"),
    ]
    for label, fn in rows:
        lines.append(f"| {label} | " + " | ".join(str(fn(agg[p])) for p in PIPELINES) + " |")
    lines += ["", "`baseline_det` = baseline output + deterministic date resolution and anonymous-owner "
              "clearing (ablation isolating the event fold).", "", "## Per case", ""]
    for trial in report["trials"]:
        lines.append(f"### Trial {trial['trial']}")
        lines.append("")
        lines.append("| case | " + " | ".join(PIPELINES) + " |")
        lines.append("|---|" + "---|" * len(PIPELINES))
        for case in trial["cases"]:
            cells = []
            for p in PIPELINES:
                sc = case[p]["score"]
                ok = sc["strict_tp"] == sc["expected"] and sc["false_positives"] == 0 and all(sc["checks"].values())
                err = " ERROR" if case[p].get("error") else ""
                cells.append(f"{'PASS' if ok else 'FAIL'} ({sc['strict_tp']}/{sc['expected']}, fp {sc['false_positives']}, q {sc['clarifications']}){err}")
            lines.append(f"| {case['id']} | " + " | ".join(cells) + " |")
        lines.append("")
        lines.append("Mismatches:")
        lines.append("")
        for case in trial["cases"]:
            for p in PIPELINES:
                sc = case[p]["score"]
                failed_checks = [k for k, v in sc["checks"].items() if not v]
                for mm in sc["mismatches"]:
                    pred = mm.get("predicted")
                    desc = f"pred “{pred.get('title')}” owner={pred.get('owner')} due={pred.get('due_date')} state={pred.get('state')}" if pred else ""
                    lines.append(f"- {case['id']} / {p}: {mm['problem']} {desc}".rstrip())
                for k in failed_checks:
                    lines.append(f"- {case['id']} / {p}: check failed: {k}")
                if case[p].get("error"):
                    lines.append(f"- {case['id']} / {p}: ERROR {case[p]['error'][:200]}")
        lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    ap.add_argument("--keys", default=str(DEFAULT_KEYS))
    ap.add_argument("--provider", default=None, help="gemini | ollama (default: LLM_PROVIDER / auto)")
    ap.add_argument("--model", default=None)
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--cases", default="", help="comma-separated case ids (default: all)")
    ap.add_argument("--replay", default=None, help="re-score raw responses recorded in a previous report")
    ap.add_argument("--out", default=str(ROOT / "evaluation" / "results"))
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    fixtures = json.loads(Path(args.fixtures).read_text())["fixtures"]
    keys = json.loads(Path(args.keys).read_text())["cases"]
    wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
    fixtures = [f for f in fixtures if not wanted or f["id"] in wanted]
    settings = get_settings()

    recorded_trials = None
    if args.replay:
        prev = json.loads(Path(args.replay).read_text())
        recorded_trials = prev["trials"]
        provider, model = prev["meta"]["provider"], prev["meta"]["model"]
        temperature, seed = prev["meta"]["temperature"], prev["meta"]["seed"]
        llm = None
        trials = len(recorded_trials)
    else:
        llm = get_llm(settings, provider=args.provider, model=args.model)
        provider, model = llm.provider, llm.model
        temperature, seed = llm.temperature, llm.seed
        trials = args.trials

    started = datetime.now(timezone.utc)
    run_id = started.strftime("%Y%m%dT%H%M%SZ") + f"_{provider}_{model.replace(':', '-').replace('/', '-')}"
    if args.replay:
        run_id += "_replay"
    if args.tag:
        run_id += f"_{args.tag}"
    t0 = time.monotonic()
    report = {"meta": {
        "run_id": run_id, "provider": provider, "model": model, "temperature": temperature,
        "seed": seed, "trials": trials, "mode": "replay" if args.replay else "live",
        "replayed_from": args.replay, "started_at": started.isoformat(),
        "host": f"{platform.system()} {platform.machine()}", "fixtures": args.fixtures,
        "synthetic": True, "prompt_version": PROMPT_VERSION,
        "prompts_sha": __import__("hashlib").sha256((BASELINE_SYSTEM + CANDIDATE_SYSTEM).encode()).hexdigest()[:12],
    }, "trials": []}

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{run_id}.json"
    for trial in range(1, trials + 1):
        cases = []
        rec_cases = {c["id"]: c for c in recorded_trials[trial - 1]["cases"]} if recorded_trials else {}
        for fx in fixtures:
            print(f"[trial {trial}] {fx['id']} ...", flush=True)
            rec = rec_cases.get(fx["id"]) if recorded_trials else None
            if recorded_trials and rec is None:
                continue
            res = evaluate_case(fx, keys.get(fx["id"], {}), llm, rec)
            for p in PIPELINES:
                sc = res[p]["score"]
                print(f"    {p:13s} strict {sc['strict_tp']}/{sc['expected']} fp={sc['false_positives']} "
                      f"q={sc['clarifications']} checks={sc['checks']}{' ERROR' if res[p].get('error') else ''}",
                      flush=True)
            cases.append(res)
            report["trials"] = [t for t in report["trials"] if t["trial"] != trial] + [
                {"trial": trial, "cases": cases}]
            json_path.write_text(json.dumps(report, indent=2, default=str))  # checkpoint
    report["meta"]["wall_seconds"] = round(time.monotonic() - t0, 1)
    all_cases = {f"{t['trial']}:{c['id']}": c for t in report["trials"] for c in t["cases"]}
    report["aggregate"] = {p: aggregate({k: c[p]["score"] for k, c in all_cases.items()}) for p in PIPELINES}
    json_path.write_text(json.dumps(report, indent=2, default=str))
    md_path = out_dir / f"{run_id}.md"
    md_path.write_text(render_markdown(report))
    print(f"\nwrote {json_path}\nwrote {md_path}")
    print(json.dumps(report["aggregate"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
