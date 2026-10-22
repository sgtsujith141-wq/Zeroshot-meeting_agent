"""Scoring for the synthetic engineering fixtures (pre-registered; see RUBRIC.md).

Inputs per case: predicted items in the common form produced by
app.services.pipelines (title, owner, due_date, state, existing_task_id,
operation, blocked_by) and the list of clarification questions raised.
"""

from __future__ import annotations

import re

ACTIVE = {"proposed", "needs_clarification"}
# Rubric v2: completing or cancelling an APPROVED task is a proposed operation, not
# an active commitment; it is scored by expected_ops / forbidden_ops instead.
CLOSING_OPS = {"complete", "cancel"}


def is_active(item: dict) -> bool:
    return item.get("state") in ACTIVE and item.get("operation") not in CLOSING_OPS


def has_op(items: list[dict], task_id: str, op: str) -> bool:
    return any(i.get("existing_task_id") == task_id and i.get("operation") == op
               and i.get("state") not in ("held", "excluded", "no_change") for i in items)


def _words(title: str | None) -> list[str]:
    return re.findall(r"[a-z0-9]+", (title or "").lower())


def keys_match(title: str | None, spec: dict) -> bool:
    words = _words(title)
    for group in spec.get("groups", []):
        if not any(w.startswith(alt) for alt in group for w in words):
            return False
    if any(w.startswith(x) for x in spec.get("exclude", []) for w in words):
        return False
    return True


def _norm_owner(o: str | None) -> str | None:
    return o.strip().lower() if isinstance(o, str) and o.strip() else None


def score_case(fixture: dict, spec: dict, items: list[dict], clarifications: list[str]) -> dict:
    expected = fixture["expected_final_active_commitments"]
    exp_specs = spec.get("items", [])
    active = [i for i in items if is_active(i)]

    # Greedy one-to-one assignment: task_id matches first, then keyword matches in order.
    used: set[int] = set()
    pairs: list[tuple[int, int | None]] = []
    for ei, exp in enumerate(expected):
        es = exp_specs[ei] if ei < len(exp_specs) else {"groups": [[w] for w in _words(exp["title"])]}
        match = None
        if exp.get("task_id"):
            for pi, p in enumerate(active):
                if pi not in used and p.get("existing_task_id") == exp["task_id"]:
                    match = pi
                    break
        if match is None:
            for pi, p in enumerate(active):
                if pi not in used and keys_match(p.get("title"), es):
                    match = pi
                    break
        if match is not None:
            used.add(match)
        pairs.append((ei, match))

    lenient_tp = sum(1 for _, m in pairs if m is not None)
    strict_tp = 0
    mismatches: list[dict] = []
    owner_errors = due_errors = state_errors = 0
    dep_total = dep_correct = 0
    for ei, pi in pairs:
        exp = expected[ei]
        if pi is None:
            mismatches.append({"expected": exp, "problem": "missing (false negative)"})
            continue
        p = active[pi]
        problems = []
        if _norm_owner(p.get("owner")) != _norm_owner(exp.get("owner")):
            owner_errors += 1
            problems.append(f"owner {p.get('owner')!r} != {exp.get('owner')!r}")
        if "due_date" in exp and p.get("due_date") != exp["due_date"]:
            due_errors += 1
            problems.append(f"due {p.get('due_date')!r} != {exp['due_date']!r}")
        if exp.get("state") and p.get("state") != exp["state"]:
            state_errors += 1
            problems.append(f"state {p.get('state')!r} != {exp['state']!r}")
        if exp.get("task_id") and p.get("existing_task_id") != exp["task_id"]:
            problems.append(f"not linked to {exp['task_id']} (duplicate/new task instead)")
        if "blocked_by" in exp:
            dep_total += 1
            prereq_idx = next((i for i, e in enumerate(expected) if e["title"] == exp["blocked_by"]), None)
            prereq_spec = exp_specs[prereq_idx] if prereq_idx is not None else {"groups": []}
            prereq_spec = {k: v for k, v in prereq_spec.items() if k != "exclude"}
            if any(keys_match(b, prereq_spec) for b in p.get("blocked_by") or []):
                dep_correct += 1
            else:
                problems.append(f"blocked_by {p.get('blocked_by')!r} != {exp['blocked_by']!r}")
        if problems:
            mismatches.append({"expected": exp, "predicted": p, "problem": "; ".join(problems)})
        else:
            strict_tp += 1

    false_pos = [active[i] for i in range(len(active)) if i not in used]
    for fp in false_pos:
        mismatches.append({"predicted": fp, "problem": "unexpected active item (false positive)"})

    checks: dict[str, bool] = {}
    for n, group in enumerate(spec.get("forbidden_active", [])):
        hit = [i for i in active if keys_match(i.get("title"), {"groups": [group]})]
        checks[f"no_active_{'_'.join(group)}"] = not hit
    if spec.get("must_update_existing"):
        tid = spec["must_update_existing"]
        exp_owner = _norm_owner(expected[0].get("owner")) if expected else None
        linked = [i for i in active if i.get("existing_task_id") == tid]
        dup = [i for i in active if not i.get("existing_task_id") and keys_match(i.get("title"), exp_specs[0])]
        checks["updates_existing_task"] = bool(linked) and _norm_owner(linked[0].get("owner")) == exp_owner
        checks["no_duplicate_task"] = not dup
    if spec.get("protected_existing"):
        tid = spec["protected_existing"]
        touched = [i for i in items if i.get("existing_task_id") == tid
                   and (i.get("state") in ACTIVE or i.get("state") == "cancelled")]
        checks["existing_task_not_changed_or_cancelled"] = not touched
    for eo in spec.get("expected_ops", []):
        checks[f"op_{eo['op']}_{eo['task_id']}"] = has_op(items, eo["task_id"], eo["op"])
    for fo in spec.get("forbidden_ops", []):
        checks[f"no_{fo['op']}_{fo['task_id']}"] = not has_op(items, fo["task_id"], fo["op"])
    if spec.get("requires_clarification"):
        checks["clarification_raised"] = bool(clarifications)

    return {
        "expected": len(expected), "predicted_active": len(active),
        "lenient_tp": lenient_tp, "strict_tp": strict_tp,
        "false_positives": len(false_pos), "false_negatives": len(expected) - strict_tp,
        "owner_errors": owner_errors, "due_errors": due_errors, "state_errors": state_errors,
        "dependency_total": dep_total, "dependency_correct": dep_correct,
        "clarifications": len(clarifications),
        "clean_case": not fixture.get("expected_flags"),
        "checks": checks, "mismatches": mismatches,
    }


def aggregate(case_scores: dict[str, dict]) -> dict:
    s = list(case_scores.values())
    exp = sum(c["expected"] for c in s)
    pred = sum(c["predicted_active"] for c in s)
    stp = sum(c["strict_tp"] for c in s)
    ltp = sum(c["lenient_tp"] for c in s)

    def prf(tp: int) -> dict:
        p = tp / pred if pred else (1.0 if exp == 0 else 0.0)
        r = tp / exp if exp else 1.0
        f = 2 * p * r / (p + r) if (p + r) else 0.0
        return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f, 3), "tp": tp}

    checks = [v for c in s for v in c["checks"].values()]
    return {
        "cases": len(s), "expected_items": exp, "predicted_active_items": pred,
        "strict": prf(stp), "lenient": prf(ltp),
        "owner_errors": sum(c["owner_errors"] for c in s),
        "due_errors": sum(c["due_errors"] for c in s),
        "state_errors": sum(c["state_errors"] for c in s),
        "false_positives": sum(c["false_positives"] for c in s),
        "dependencies": f"{sum(c['dependency_correct'] for c in s)}/{sum(c['dependency_total'] for c in s)}",
        "safety_checks_passed": f"{sum(checks)}/{len(checks)}",
        "clarifications_on_clean_cases": sum(c["clarifications"] for c in s if c["clean_case"]),
        "cases_fully_correct": sum(1 for c in s if c["strict_tp"] == c["expected"]
                                   and c["false_positives"] == 0 and all(c["checks"].values())),
    }
