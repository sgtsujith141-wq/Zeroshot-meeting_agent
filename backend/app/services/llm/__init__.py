"""LLM provider selection. There is no fake provider: if no real model is
reachable, callers get LLMUnavailable and must surface it."""

from __future__ import annotations

from ...config import Settings, get_settings
from .base import LLMCall, LLMClient, LLMError, LLMOutputError, LLMUnavailable
from .ollama import OllamaClient, ollama_models

__all__ = ["LLMCall", "LLMClient", "LLMError", "LLMOutputError", "LLMUnavailable", "get_llm", "llm_status"]


def get_llm(settings: Settings | None = None, provider: str | None = None,
            model: str | None = None) -> LLMClient:
    s = settings or get_settings()
    choice = (provider or s.llm_provider or "auto").lower()
    if choice == "auto":
        if s.gemini_api_key:
            choice = "gemini"
        elif ollama_models(s.ollama_base_url) is not None:
            choice = "ollama"
        else:
            raise LLMUnavailable("No LLM configured: set GEMINI_API_KEY or run a local Ollama server")
    if choice == "gemini":
        from .gemini import GeminiClient
        return GeminiClient(s.gemini_api_key, model or s.gemini_model, s.llm_temperature,
                            s.llm_seed, s.llm_timeout_seconds)
    if choice == "ollama":
        name = model or s.ollama_model
        available = ollama_models(s.ollama_base_url)
        if available is None:
            raise LLMUnavailable(f"Ollama not reachable at {s.ollama_base_url}")
        if name not in available:
            raise LLMUnavailable(f"Ollama model '{name}' is not pulled (available: {', '.join(available)})")
        return OllamaClient(s.ollama_base_url, name, s.llm_temperature, s.llm_seed,
                            s.llm_timeout_seconds)
    raise LLMUnavailable(f"Unknown LLM_PROVIDER '{choice}'")


def llm_status(settings: Settings | None = None) -> dict:
    s = settings or get_settings()
    models = ollama_models(s.ollama_base_url)
    try:
        active = get_llm(s)
        active_desc = {"provider": active.provider, "model": active.model}
    except LLMUnavailable as exc:
        active_desc = {"provider": None, "model": None, "error": str(exc)}
    return {
        "configured_provider": s.llm_provider,
        "active": active_desc,
        "gemini": {"api_key_present": bool(s.gemini_api_key), "model": s.gemini_model},
        "ollama": {"reachable": models is not None, "model": s.ollama_model,
                   "model_available": bool(models and s.ollama_model in models)},
        "temperature": s.llm_temperature,
        "seed": s.llm_seed,
    }
