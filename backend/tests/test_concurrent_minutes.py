"""Minutes requested alongside the interpretation (LLM_CONCURRENT_MINUTES=1, the default outside
tests) must store exactly what the sequential order stores, and fail the same way."""

from __future__ import annotations

from app.services import processing
from app.services.llm import LLMError
from test_api_flow import change_set, first_meeting


def stored(client, mid):
    m = client.get(f"/api/meetings/{mid}").json()
    cs = change_set(client, mid)
    return {"summary": m["minutes"]["summary"], "decisions": [d["text"] for d in m["decisions"]],
            "items": [(i["title"], i["owner"], i["deadline"]["date"], i["state"]) for i in cs["proposal"]["items"]],
            "status": m["processing_status"], "steps": [entry["step"] for entry in m["processing_log"]]}


def test_concurrent_minutes_store_the_same_result_as_sequential(client, llm, monkeypatch):
    sequential = stored(client, first_meeting(client, llm))
    monkeypatch.setenv("LLM_CONCURRENT_MINUTES", "1")
    second = first_meeting(client, llm)
    concurrent = stored(client, second)
    assert concurrent["summary"] == sequential["summary"] and concurrent["status"] == "ready_for_review"
    assert [i[0] for i in concurrent["items"]] == [i[0] for i in sequential["items"]]
    assert concurrent["steps"] == ["queue", "interpret", "minutes", "changeset"]
    assert llm.calls.count("minutes") == 2


def test_an_interpretation_failure_with_minutes_in_flight_fails_cleanly(client, llm, monkeypatch):
    monkeypatch.setenv("LLM_CONCURRENT_MINUTES", "1")

    def broken(*a, **k):
        raise LLMError("model returned invalid JSON twice")
    monkeypatch.setattr(processing, "interpret", broken)
    mid = first_meeting(client, llm)
    m = client.get(f"/api/meetings/{mid}").json()
    assert m["processing_status"] == "failed" and m["processing_error"].startswith("interpret:")
    assert m["segments"] and not m["minutes"].get("summary")  # transcript kept; no half-written results
