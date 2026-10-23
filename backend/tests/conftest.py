"""Test fixtures. Integration tests run OFFLINE: LLM output is supplied by
FixtureLLM (provider "test-fixture"), clearly separate from any real model.
Live-model behaviour is measured by evaluation/run_eval.py instead."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.services.llm.base import LLMCall


class FixtureLLM:
    provider, model, temperature, seed = "test-fixture", "recorded-json", 0.0, 0

    def __init__(self):
        self.queue: dict[str, list[dict]] = {}
        self.calls: list[str] = []

    def push(self, purpose: str, payload: dict) -> None:
        self.queue.setdefault(purpose, []).append(payload)

    def generate_json(self, system, user, out_model, purpose, max_attempts=2):  # noqa: ANN001
        self.calls.append(purpose)
        if purpose == "minutes" and not self.queue.get("minutes"):
            payload = {"summary": "Fixture summary.", "discussion": [], "decisions": [], "open_questions": []}
        else:
            payload = self.queue[purpose].pop(0)
        call = LLMCall(self.provider, self.model, purpose, 0.0, 0, latency_ms=1, attempts=1,
                       raw_text=json.dumps(payload))
        return out_model.model_validate(payload), call


class _SyncExecutor:
    def submit(self, fn, *a, **kw):  # noqa: ANN001
        fn(*a, **kw)


@pytest.fixture
def llm(monkeypatch):
    fake = FixtureLLM()
    from app.services import memory, processing
    monkeypatch.setattr(processing, "get_llm", lambda *a, **k: fake)
    monkeypatch.setattr(memory, "get_llm", lambda *a, **k: fake)
    monkeypatch.setattr(processing, "_executor", _SyncExecutor())
    return fake


@pytest.fixture
def client(tmp_path, monkeypatch, llm):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORGANIZER_TOKEN", "test-token")
    monkeypatch.setenv("REMINDER_POLL_SECONDS", "0")
    monkeypatch.setenv("WHISPER_PREWARM", "0")
    monkeypatch.setenv("LLM_CONCURRENT_MINUTES", "0")  # deterministic call order; one test turns it on
    monkeypatch.setenv("SMTP_HOST", "")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.main import app
    with TestClient(app) as c:
        c.headers["Authorization"] = "Bearer test-token"
        yield c
    from app.services.clock import set_simulated_clock
    set_simulated_clock(None)
    get_settings.cache_clear()
