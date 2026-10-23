"""Fast task-state answers: approved records answer owner/due/pending/blocked questions without a
model call; ambiguous names ask which task; anything else falls through to the grounded path."""

from __future__ import annotations

from test_api_flow import approve, change_set, first_meeting


def ask(client, q, use_llm=True):
    r = client.post("/api/memory/query", json={"question": q, "use_llm": use_llm})
    assert r.status_code == 200, r.text
    return r.json()


def setup(client, llm):
    first_meeting(client, llm)
    approve(client, change_set(client, 1))
    return {t["title"]: t for t in client.get("/api/tasks").json()}


def test_owner_and_due_come_from_records_without_a_model_call(client, llm):
    tasks = setup(client, llm)
    api = tasks["Complete authentication API"]
    r = ask(client, "Who owns the authentication API and when is it due?")
    assert r["mode"] == "task_records" and r["found"] is True
    assert f"owned by {api['owner']}" in r["answer"] and "Fri 23 Oct 2026" in r["answer"]
    assert [s["code"] for s in r["current_state"]] == [api["code"]]
    assert all(p["doc_type"] == "segment" and p["meeting_id"] == 1 for p in r["citations"])  # where it was agreed
    assert "memory_answer" not in llm.calls
    assert r["latency_ms"] >= 0


def test_explicit_code_status_and_blocked(client, llm):
    tasks = setup(client, llm)
    test_task, api = tasks["Test authentication API"], tasks["Complete authentication API"]
    r = ask(client, f"Is {test_task['code']} blocked?")
    assert r["mode"] == "task_records" and f"waiting for {api['code']}" in r["answer"]
    r = ask(client, f"What is the status of {api['code']}?")
    assert "todo" in r["answer"] and "revision 1" in r["answer"]


def test_lists_pending_blocked_and_a_persons_tasks(client, llm):
    tasks = setup(client, llm)
    r = ask(client, "What is still pending?")
    assert r["mode"] == "task_records" and len(r["current_state"]) == 2
    r = ask(client, "Which tasks are blocked?")
    assert [s["title"] for s in r["current_state"]] == ["Test authentication API"]
    r = ask(client, "What is Samiksha working on?")
    assert [s["title"] for s in r["current_state"]] == ["Test authentication API"]
    assert "memory_answer" not in llm.calls


def test_ambiguous_task_names_ask_which_task_instead_of_guessing(client, llm):
    tasks = setup(client, llm)
    api = tasks["Complete authentication API"]
    client.patch(f"/api/tasks/{api['code']}", json={"expected_revision": 1, "title": "Build authentication API"})
    r = ask(client, "Who owns the authentication API?")
    assert r["mode"] == "task_records" and r["found"] is False
    assert {c["title"] for c in r["clarify"]} == {"Build authentication API", "Test authentication API"}
    assert r["answer"].startswith("Which task do you mean?")


def test_discussion_questions_still_use_the_grounded_path(client, llm):
    setup(client, llm)
    for q in ("Who said the authentication API would be ready?", "When did we decide to keep the session store?",
              "Why do we keep the existing session store?"):
        r = ask(client, q, use_llm=False)
        assert r["mode"] in ("extractive", "retrieval"), (q, r["mode"])
    llm.push("memory_answer", {"answer": "To avoid a migration.", "citations": ["P1"], "found": True})
    r = ask(client, "Why do we keep the existing session store?")
    assert r["mode"] == "llm_grounded" and "memory_answer" in llm.calls


def test_no_tasks_means_no_fast_answer(client, llm):
    r = ask(client, "What is still pending?", use_llm=False)
    assert r["mode"] == "retrieval" and r["found"] is False
