"""Google Gemini provider (free tier)."""

import google.generativeai as genai

from src.ai.providers.base import AIProvider, ProviderError, RateLimitedError


class GeminiProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        genai.configure(api_key=api_key)
        self._model_name = model
        self._model = genai.GenerativeModel(
            model_name=model,
            system_instruction=None,  # set per-call
        )

    @property
    def name(self) -> str:
        return "Google Gemini"

    def call(self, system_prompt: str, user_prompt: str, max_tokens: int) -> str:
        try:
            # Create model with system instruction for this call
            model = genai.GenerativeModel(
                model_name=self._model_name,
                system_instruction=system_prompt,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=max_tokens,
                    temperature=0,
                    response_mime_type="application/json",
                ),
            )
            response = model.generate_content(user_prompt)
            return response.text.strip()
        except Exception as e:
            err_str = str(e).lower()
            if "resource" in err_str and "exhaust" in err_str:
                raise RateLimitedError(str(e)) from e
            if "quota" in err_str or "rate" in err_str:
                raise RateLimitedError(str(e)) from e
            raise ProviderError(f"Gemini API error: {e}") from e

    def validate_key(self) -> bool:
        try:
            model = genai.GenerativeModel(model_name=self._model_name)
            model.generate_content("hi", generation_config=genai.types.GenerationConfig(max_output_tokens=10))
            return True
        except Exception as e:
            err_str = str(e).lower()
            if "api key" in err_str or "permission" in err_str or "invalid" in err_str:
                return False
            return True  # Key is valid, some other issue
