"""Reproducible package and local Codex marketplace construction."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

from .validation import validate_repository


INCLUDED_DIRECTORIES = (
    ".codex-plugin",
    "skills",
    "tools",
    "environment",
    "scripts",
)
INCLUDED_ROOT_FILES = ("README.md", "USER_GUIDE.md", "LICENSE")
EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".zip"}
TEXT_SUFFIXES = {
    ".cmd",
    ".cpp",
    ".json",
    ".md",
    ".ps1",
    ".py",
    ".txt",
    ".yaml",
    ".yml",
}
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)
MARKETPLACE_NAME = "processor-development-skills-local"


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _normalized_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.suffix.casefold() in TEXT_SUFFIXES:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError(f"text file is not UTF-8: {path}") from error
        data = text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    return data


def _is_included_file(path: Path, base: Path) -> bool:
    relative = path.relative_to(base)
    if any(part in EXCLUDED_PARTS or part.startswith(".") and part != ".codex-plugin" for part in relative.parts):
        return False
    if path.suffix.casefold() in EXCLUDED_SUFFIXES:
        return False
    return path.is_file() and not path.is_symlink()


def collect_payload(repo_root: Path) -> dict[str, bytes]:
    payload: dict[str, bytes] = {}
    missing: list[str] = []
    for name in INCLUDED_ROOT_FILES:
        path = repo_root / name
        if not path.is_file():
            missing.append(name)
        else:
            payload[name] = _normalized_bytes(path)
    for name in INCLUDED_DIRECTORIES:
        directory = repo_root / name
        if not directory.is_dir():
            missing.append(f"{name}/")
            continue
        for path in sorted(directory.rglob("*"), key=lambda item: item.as_posix()):
            if _is_included_file(path, repo_root):
                relative = path.relative_to(repo_root).as_posix()
                payload[relative] = _normalized_bytes(path)
    if missing:
        raise ValueError(f"package inputs are missing: {', '.join(missing)}")
    return payload


def _payload_digest(payload: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for path, data in sorted(payload.items()):
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(data).digest())
        digest.update(b"\0")
    return digest.hexdigest()


def _git_identity(repo_root: Path) -> tuple[str | None, bool]:
    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(repo_root), *args],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )

    revision = git("rev-parse", "HEAD")
    if revision.returncode != 0:
        return None, True
    status = git("status", "--porcelain", "--untracked-files=all")
    if status.returncode != 0:
        raise RuntimeError(f"git status failed: {status.stderr.strip()}")
    return revision.stdout.strip(), bool(status.stdout.strip())


def _write_payload(root: Path, payload: dict[str, bytes]) -> None:
    for relative, data in sorted(payload.items()):
        target = root / Path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def _write_deterministic_zip(source_root: Path, destination: Path) -> str:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as archive:
        for path in sorted(source_root.rglob("*"), key=lambda item: item.as_posix()):
            if not path.is_file():
                continue
            relative = path.relative_to(source_root).as_posix()
            info = zipfile.ZipInfo(relative, FIXED_ZIP_TIME)
            info.create_system = 3
            info.external_attr = (0o644 & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, path.read_bytes())
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def _safe_replace_directory(source: Path, destination: Path, output_root: Path) -> None:
    resolved_output = output_root.resolve()
    resolved_destination = destination.resolve()
    if resolved_destination.parent != resolved_output or resolved_destination == resolved_output:
        raise ValueError(f"refusing to replace unsafe generated directory: {destination}")
    if destination.exists():
        shutil.rmtree(destination)
    shutil.move(str(source), str(destination))


def build_package(
    repo_root: Path,
    output_root: Path,
    *,
    allow_dirty: bool = False,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    output_root = output_root.resolve()
    validation = validate_repository(repo_root)
    if not validation["ok"]:
        raise ValueError("repository validation failed: " + "; ".join(validation["errors"]))

    plugin = json.loads((repo_root / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    plugin_name = plugin["name"]
    version = plugin["version"]
    commit, dirty = _git_identity(repo_root)
    if dirty and not allow_dirty:
        raise ValueError("working tree is dirty; commit the package inputs or pass --allow-dirty")

    payload = collect_payload(repo_root)
    payload_hash = _payload_digest(payload)
    package_manifest = {
        "schemaVersion": 1,
        "pluginName": plugin_name,
        "version": version,
        "sourceCommit": commit,
        "sourceDirty": dirty,
        "payloadSha256": payload_hash,
        "files": [
            {
                "path": path,
                "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data),
            }
            for path, data in sorted(payload.items())
        ],
    }
    payload["PACKAGE_MANIFEST.json"] = _json_bytes(package_manifest)

    output_root.mkdir(parents=True, exist_ok=True)
    zip_name = f"{plugin_name}-{version}.zip"
    zip_path = output_root / zip_name
    marketplace_path = output_root / "marketplace"

    with tempfile.TemporaryDirectory(prefix="package-", dir=output_root) as temp_name:
        temp_root = Path(temp_name)
        plugin_stage = temp_root / plugin_name
        _write_payload(plugin_stage, payload)

        temp_zip = temp_root / zip_name
        zip_hash = _write_deterministic_zip(plugin_stage, temp_zip)
        os.replace(temp_zip, zip_path)

        marketplace_stage = temp_root / "marketplace"
        marketplace_plugin = marketplace_stage / "plugins" / plugin_name
        shutil.copytree(plugin_stage, marketplace_plugin)
        marketplace = {
            "name": MARKETPLACE_NAME,
            "interface": {"displayName": "Processor Development Skills Local"},
            "plugins": [
                {
                    "name": plugin_name,
                    "source": {"source": "local", "path": f"./plugins/{plugin_name}"},
                    "policy": {
                        "installation": "AVAILABLE",
                        "authentication": "ON_INSTALL",
                    },
                    "category": "Developer Tools",
                }
            ],
        }
        marketplace_manifest = marketplace_stage / ".agents" / "plugins" / "marketplace.json"
        marketplace_manifest.parent.mkdir(parents=True, exist_ok=True)
        marketplace_manifest.write_bytes(_json_bytes(marketplace))
        _safe_replace_directory(marketplace_stage, marketplace_path, output_root)

    checksum_path = output_root / f"{zip_name}.sha256"
    checksum_path.write_text(f"{zip_hash}  {zip_name}\n", encoding="utf-8", newline="\n")
    return {
        "schemaVersion": 1,
        "ok": True,
        "pluginName": plugin_name,
        "version": version,
        "sourceCommit": commit,
        "sourceDirty": dirty,
        "payloadSha256": payload_hash,
        "fileCount": len(payload),
        "archive": str(zip_path),
        "archiveSha256": zip_hash,
        "checksum": str(checksum_path),
        "marketplace": str(marketplace_path),
        "marketplaceName": MARKETPLACE_NAME,
    }
