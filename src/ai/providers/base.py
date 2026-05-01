"""Abstract base class for AI providers."""

from abc import ABC, abstractmethod


class ProviderError(Exception):
    """Base error for provider-specific failures."""
    pass


class RateLimitedError(ProviderError):
    """The provider rate-limited the request."""
    pass


class AIProvider(ABC):
    @abstractmethod
    def call(self, system_prompt: str, user_prompt: str, max_tokens: int) -> str:
        """Send a prompt and return the raw text response."""
        ...

    @abstractmethod
    def validate_key(self) -> bool:
        """Test connectivity / key validity. Return True if working."""
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name for display."""
        ...
