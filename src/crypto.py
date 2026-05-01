"""Credential encryption — encrypts sensitive settings at rest using Fernet.

A machine-local encryption key is generated once and stored at config/encryption.key.
This protects credentials if config files are accidentally shared or committed,
but does NOT protect against an attacker with full filesystem access (they can
read the key too). For that, use OS keyring (future improvement).
"""

import base64
import os

from cryptography.fernet import Fernet, InvalidToken

from src.paths import CONFIG_DIR

KEY_PATH = CONFIG_DIR / "encryption.key"
_ENCRYPTED_PREFIX = "enc:"


def _get_or_create_key() -> bytes:
    """Get existing encryption key or generate a new one."""
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if KEY_PATH.exists():
        key = KEY_PATH.read_bytes().strip()
        if key:
            return key
    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    os.chmod(str(KEY_PATH), 0o600)  # Owner-only read/write
    return key


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value. Returns prefixed ciphertext."""
    if not plaintext or plaintext.startswith(_ENCRYPTED_PREFIX):
        return plaintext  # Already encrypted or empty
    key = _get_or_create_key()
    f = Fernet(key)
    encrypted = f.encrypt(plaintext.encode("utf-8"))
    return _ENCRYPTED_PREFIX + base64.urlsafe_b64encode(encrypted).decode("ascii")


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a string value. Returns plaintext. If not encrypted, returns as-is."""
    if not ciphertext or not ciphertext.startswith(_ENCRYPTED_PREFIX):
        return ciphertext  # Not encrypted
    try:
        key = _get_or_create_key()
        f = Fernet(key)
        raw = base64.urlsafe_b64decode(ciphertext[len(_ENCRYPTED_PREFIX):])
        return f.decrypt(raw).decode("utf-8")
    except (InvalidToken, Exception):
        # If decryption fails (wrong key, corrupted), return empty
        return ""


def is_encrypted(value: str) -> bool:
    """Check if a value is already encrypted."""
    return value.startswith(_ENCRYPTED_PREFIX) if value else False
