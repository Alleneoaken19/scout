"""Backward-compat shim — imports from the new generic AI client."""

from src.ai.ai_client import AICallError, call_json, wrap_user_input  # noqa: F401
