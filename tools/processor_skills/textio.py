"""Strict UTF-8 text input for Windows-native package entrypoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any


UTF8_BOM = b"\xef\xbb\xbf"
UTF8_SMOKE_TEXT = "Processor Development Skills UTF-8 smoke: 处理器文档\n"


class Utf8DecodeError(ValueError):
    """Raised when a declared UTF-8 text file cannot be decoded."""


def inspect_utf8_text(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    payload = resolved.read_bytes()
    has_bom = payload.startswith(UTF8_BOM)
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise Utf8DecodeError(
            f"text is not valid UTF-8: {resolved}; byteOffset={error.start}"
        ) from error
    return {
        "schemaVersion": 1,
        "ok": True,
        "path": str(resolved),
        "encoding": "utf-8",
        "bom": has_bom,
        "text": text,
    }


def read_utf8_text(path: Path) -> str:
    return str(inspect_utf8_text(path)["text"])


def check_utf8_smoke(path: Path, expected: str) -> dict[str, Any]:
    try:
        inspected = inspect_utf8_text(path)
    except (OSError, Utf8DecodeError) as error:
        return {
            "ok": False,
            "path": str(path.resolve()),
            "encoding": "utf-8",
            "detail": str(error),
        }
    actual = str(inspected["text"]).replace("\r\n", "\n").replace("\r", "\n")
    normalized_expected = expected.replace("\r\n", "\n").replace("\r", "\n")
    ok = actual == normalized_expected
    return {
        "ok": ok,
        "path": inspected["path"],
        "encoding": inspected["encoding"],
        "bom": inspected["bom"],
        "detail": None if ok else "UTF-8 smoke content does not match the package contract",
    }
