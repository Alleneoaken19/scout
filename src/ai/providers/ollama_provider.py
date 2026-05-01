"""Ollama provider (free, local)."""

import httpx

from src.ai.providers.base import AIProvider, ProviderError

OLLAMA_BASE = "http://localhost:11434"


class OllamaProvider(AIProvider):
    def __init__(self, model: str):
        self._model = model

    @property
    def name(self) -> str:
        return "Ollama"

    def call(self, system_prompt: str, user_prompt: str, max_tokens: int) -> str:
        try:
            response = httpx.post(
                f"{OLLAMA_BASE}/api/chat",
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "format": "json",
                    "stream": False,
                    "options": {
                        "num_predict": max_tokens,
                        "temperature": 0,
                    },
                },
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"].strip()
        except httpx.ConnectError as e:
            raise ProviderError(
                "Cannot connect to Ollama. Is it running? Start with: ollama serve"
            ) from e
        except httpx.TimeoutException as e:
            raise ProviderError(f"Ollama request timed out: {e}") from e
        except httpx.HTTPStatusError as e:
            raise ProviderError(f"Ollama HTTP error: {e}") from e
        except KeyError as e:
            raise ProviderError(f"Unexpected Ollama response format: {e}") from e

    def validate_key(self) -> bool:
        try:
            # Check if Ollama is running
            resp = httpx.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
            resp.raise_for_status()
            # Check if the model is available
            models = resp.json().get("models", [])
            model_names = [m.get("name", "").split(":")[0] for m in models]
            if self._model.split(":")[0] not in model_names:
                return False
            return True
        except Exception:
            return False
