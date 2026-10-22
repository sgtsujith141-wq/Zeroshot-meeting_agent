from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from ..llm_schemas import inline_schema

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


class LLMUnavailable(LLMError):
    pass


@dataclass
class LLMCall:
    provider: str
    model: str
    purpose: str
    temperature: float
    seed: int | None
    latency_ms: int = 0
    attempts: int = 0
    raw_text: str = ""
    usage: dict = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class LLMClient:
    provider = "base"

    def __init__(self, model: str, temperature: float, seed: int | None, timeout: int):
        self.model = model
        self.temperature = temperature
        self.seed = seed
        self.timeout = timeout

    def _raw(self, system: str, user: str, schema: dict) -> tuple[str, dict]:
        raise NotImplementedError

    def generate_json(self, system: str, user: str, out_model: type[T], purpose: str,
                      max_attempts: int = 2) -> tuple[T, LLMCall]:
        schema = inline_schema(out_model)
        call = LLMCall(self.provider, self.model, purpose, self.temperature, self.seed)
        prompt = user
        started = time.monotonic()
        last_err = ""
        for attempt in range(1, max_attempts + 1):
            call.attempts = attempt
            text, usage = self._raw(system, prompt, schema)
            call.raw_text, call.usage = text, usage
            try:
                parsed = out_model.model_validate_json(_strip_fences(text))
                call.latency_ms = int((time.monotonic() - started) * 1000)
                return parsed, call
            except (ValidationError, json.JSONDecodeError, ValueError) as exc:
                last_err = str(exc)[:600]
                prompt = (f"{user}\n\nYour previous output did not match the required JSON schema:\n"
                          f"{last_err}\nReturn only valid JSON matching the schema.")
        call.latency_ms = int((time.monotonic() - started) * 1000)
        call.error = f"invalid structured output after {max_attempts} attempts: {last_err}"
        raise LLMOutputError(call)


class LLMOutputError(LLMError):
    def __init__(self, call: LLMCall):
        super().__init__(call.error)
        self.call = call


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()
