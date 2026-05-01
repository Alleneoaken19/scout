"""Anthropic Claude provider."""

import anthropic

from src.ai.providers.base import AIProvider, ProviderError, RateLimitedError


class AnthropicProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    @property
    def name(self) -> str:
        return "Anthropic"

    def call(self, system_prompt: str, user_prompt: str, max_tokens: int) -> str:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                temperature=0,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return response.content[0].text.strip()
        except anthropic.RateLimitError as e:
            raise RateLimitedError(str(e)) from e
        except anthropic.APIError as e:
            raise ProviderError(f"Anthropic API error: {e}") from e

    def validate_key(self) -> bool:
        try:
            self._client.messages.create(
                model=self._model,
                max_tokens=10,
                messages=[{"role": "user", "content": "hi"}],
            )
            return True
        except anthropic.AuthenticationError:
            return False
        except anthropic.APIError:
            return True  # Key is valid, some other issue
