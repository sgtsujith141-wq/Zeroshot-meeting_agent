"""Google Gemini adapter (google-genai SDK, structured JSON-schema output).

Written against google-genai v2.x `client.models.generate_content` with
`response_mime_type="application/json"` and `response_json_schema`. It is only
reported as verified after a live smoke test succeeds with a real key.
"""

from __future__ import annotations

from .base import LLMClient, LLMError, LLMUnavailable


class GeminiClient(LLMClient):
    provider = "gemini"

    def __init__(self, api_key: str, model: str, temperature: float, seed: int | None, timeout: int):
        super().__init__(model, temperature, seed, timeout)
        if not api_key:
            raise LLMUnavailable("GEMINI_API_KEY is not set")
        from google import genai
        from google.genai import types

        self._types = types
        self._client = genai.Client(
            api_key=api_key, http_options=types.HttpOptions(timeout=timeout * 1000))

    def _raw(self, system: str, user: str, schema: dict) -> tuple[str, dict]:
        types = self._types
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=schema,
            temperature=self.temperature,
            seed=self.seed,
        )
        from google.genai import errors
        try:
            resp = self._client.models.generate_content(model=self.model, contents=user, config=config)
        except errors.ClientError as exc:  # 4xx: never retry blindly; say what to fix
            code = getattr(exc, "code", None)
            hint = {400: "bad request (schema or parameters)", 401: "invalid GEMINI_API_KEY",
                    403: "GEMINI_API_KEY not permitted for this model", 404: f"model '{self.model}' not found",
                    429: "quota or rate limit exceeded"}.get(code, "client error")
            cls = LLMUnavailable if code in (401, 403, 404) else LLMError
            raise cls(f"Gemini HTTP {code}: {hint}") from exc
        except errors.ServerError as exc:
            raise LLMError(f"Gemini server error HTTP {getattr(exc, 'code', '?')}; try again") from exc
        except Exception as exc:  # network/timeouts; keep the type, never the key
            raise LLMError(f"Gemini request failed: {type(exc).__name__}: {str(exc)[:200]}") from exc
        um = getattr(resp, "usage_metadata", None)
        usage = {"prompt_tokens": getattr(um, "prompt_token_count", None),
                 "output_tokens": getattr(um, "candidates_token_count", None)} if um else {}
        if not (resp.text or "").strip():
            reason = getattr((getattr(resp, "candidates", None) or [None])[0], "finish_reason", None)
            raise LLMError(f"Gemini returned no text (finish_reason={reason})")
        return resp.text, usage

    def list_models(self) -> list[str]:
        return [m.name for m in self._client.models.list()]
