"""Codex CLI installation helpers for the generated local marketplace."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable, Sequence


CodexRunner = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


def _default_runner(args: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )


def _run_json(args: Sequence[str], runner: CodexRunner) -> dict[str, Any]:
    completed = runner(args)
    if completed.returncode != 0:
        output = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
        raise RuntimeError(f"command failed ({completed.returncode}): {' '.join(args)}\n{output}")
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError(f"command did not return JSON: {' '.join(args)}") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"command returned a non-object JSON value: {' '.join(args)}")
    return payload


def _find_named(items: Any, name: str) -> dict[str, Any] | None:
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and item.get("name") == name:
            return item
    return None


def _contains_path(value: Any, expected: Path) -> bool:
    expected_text = str(expected.resolve()).replace("/", "\\").casefold()
    if isinstance(value, str):
        return value.replace("/", "\\").casefold() == expected_text
    if isinstance(value, list):
        return any(_contains_path(item, expected) for item in value)
    if isinstance(value, dict):
        return any(_contains_path(item, expected) for item in value.values())
    return False


def install_local_plugin(
    marketplace_root: Path,
    marketplace_name: str,
    plugin_name: str,
    *,
    codex_executable: str = "codex",
    runner: CodexRunner = _default_runner,
) -> dict[str, Any]:
    marketplace_root = marketplace_root.resolve()
    marketplace_manifest = marketplace_root / ".agents" / "plugins" / "marketplace.json"
    marketplace_payload = json.loads(
        marketplace_manifest.read_text(encoding="utf-8")
    )
    if marketplace_payload.get("name") != marketplace_name:
        raise ValueError("marketplace name does not match generated marketplace.json")

    listed = _run_json(
        [codex_executable, "plugin", "marketplace", "list", "--json"], runner
    )
    existing = _find_named(listed.get("marketplaces"), marketplace_name)
    marketplace_action = "kept"
    if existing is None:
        _run_json(
            [
                codex_executable,
                "plugin",
                "marketplace",
                "add",
                str(marketplace_root),
                "--json",
            ],
            runner,
        )
        marketplace_action = "added"
    elif not _contains_path(existing, marketplace_root):
        raise RuntimeError(
            f"marketplace {marketplace_name} already exists at another source; "
            "remove or rename that marketplace explicitly before initialization"
        )

    install_result = _run_json(
        [codex_executable, "plugin", "add", f"{plugin_name}@{marketplace_name}", "--json"],
        runner,
    )
    return {
        "ok": True,
        "plugin": plugin_name,
        "marketplace": marketplace_name,
        "marketplaceAction": marketplace_action,
        "installResult": install_result,
    }


def uninstall_local_plugin(
    marketplace_name: str,
    plugin_name: str,
    *,
    codex_executable: str = "codex",
    runner: CodexRunner = _default_runner,
) -> dict[str, Any]:
    plugin_listing = _run_json(
        [codex_executable, "plugin", "list", "--json"], runner
    )
    installed = plugin_listing.get("installed", [])
    plugin_present = any(
        isinstance(item, dict)
        and item.get("name") == plugin_name
        and item.get("marketplaceName", item.get("marketplace")) == marketplace_name
        for item in installed
    )
    plugin_action = "absent"
    if plugin_present:
        _run_json(
            [codex_executable, "plugin", "remove", f"{plugin_name}@{marketplace_name}", "--json"],
            runner,
        )
        plugin_action = "removed"

    marketplace_listing = _run_json(
        [codex_executable, "plugin", "marketplace", "list", "--json"], runner
    )
    marketplace_present = _find_named(
        marketplace_listing.get("marketplaces"), marketplace_name
    )
    marketplace_action = "absent"
    if marketplace_present is not None:
        _run_json(
            [
                codex_executable,
                "plugin",
                "marketplace",
                "remove",
                marketplace_name,
                "--json",
            ],
            runner,
        )
        marketplace_action = "removed"

    return {
        "ok": True,
        "plugin": plugin_name,
        "pluginAction": plugin_action,
        "marketplace": marketplace_name,
        "marketplaceAction": marketplace_action,
    }
