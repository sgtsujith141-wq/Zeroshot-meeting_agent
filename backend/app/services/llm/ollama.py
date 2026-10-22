"""Local Ollama adapter (real local model; structured output via JSON-schema `format`)."""

from __future__ import annotations

import os

import httpx

from .base import LLMClient, LLMError, LLMUnavailable


class OllamaClient(LLMClient):
    provider = "ollama"

    def __init__(self, base_url: str, model: str, temperature: float, seed: int | None, timeout: int):
        super().__init__(model, temperature, seed, timeout)
        self.base_url = base_url
        self.num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "16384"))
        self._think_supported: bool | None = None

    def _raw(self, system: str, user: str, schema: dict) -> tuple[str, dict]:
        body = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "keep_alive": "30m",
            "options": {"temperature": self.temperature, "num_ctx": self.num_ctx,
                        **({"seed": self.seed} if self.seed is not None else {})},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if self._think_supported is not False:
            body["think"] = False  # deterministic, schema-constrained answer without a reasoning trace
        try:
            r = httpx.post(f"{self.base_url}/api/chat", json=body, timeout=self.timeout)
            if r.status_code == 400 and "think" in r.text.lower() and "think" in body:
                self._think_supported = False
                body.pop("think")
                r = httpx.post(f"{self.base_url}/api/chat", json=body, timeout=self.timeout)
        except httpx.ConnectError as exc:
            raise LLMUnavailable(f"Ollama not reachable at {self.base_url}") from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f"Ollama request timed out after {self.timeout}s") from exc
        if r.status_code != 200:
            raise LLMError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        usage = {"prompt_tokens": data.get("prompt_eval_count"),
                 "output_tokens": data.get("eval_count"),
                 "eval_seconds": round((data.get("eval_duration") or 0) / 1e9, 2)}
        return data.get("message", {}).get("content", ""), usage


def ollama_models(base_url: str, timeout: float = 3.0) -> list[str] | None:
    try:
        r = httpx.get(f"{base_url}/api/tags", timeout=timeout)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return None
