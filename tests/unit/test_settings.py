"""Unit tests for settings backward compatibility and provider resolution."""

from src.settings import Settings


def test_backward_compat_anthropic_key():
    """Legacy ANTHROPIC_API_KEY should be auto-detected as Anthropic provider."""
    s = Settings(anthropic_api_key="sk-ant-real-key-12345")
    assert s.effective_provider == "anthropic"
    assert s.effective_api_key == "sk-ant-real-key-12345"
    assert "claude" in s.effective_model


def test_new_generic_provider_gemini():
    s = Settings(ai_provider="gemini", ai_api_key="gemini-key-xxx")
    assert s.effective_provider == "gemini"
    assert s.effective_api_key == "gemini-key-xxx"
    assert "gemini" in s.effective_model


def test_new_generic_provider_ollama():
    s = Settings(ai_provider="ollama")
    assert s.effective_provider == "ollama"
    assert s.effective_api_key == ""  # Ollama needs no key
    assert s.effective_model == "llama3.2"


def test_no_provider_configured():
    s = Settings()
    assert s.effective_provider == ""
    assert s.effective_api_key == ""


def test_generic_overrides_legacy():
    """If both ai_provider and anthropic_api_key are set, ai_provider wins."""
    s = Settings(
        ai_provider="gemini",
        ai_api_key="gemini-key",
        anthropic_api_key="sk-ant-old-key",
    )
    assert s.effective_provider == "gemini"
    assert s.effective_api_key == "gemini-key"


def test_placeholder_key_not_detected():
    """sk-ant-xxxx placeholder should not be treated as a real key."""
    s = Settings(anthropic_api_key="sk-ant-xxxx")
    assert s.effective_provider == ""
