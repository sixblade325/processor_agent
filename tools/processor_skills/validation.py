"""Structure validation for the plugin and bundled skills."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping


PLUGIN_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def _read_json_object(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing {path.as_posix()}")
        return None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        errors.append(f"invalid JSON {path.as_posix()}: {error}")
        return None
    if not isinstance(value, dict):
        errors.append(f"{path.as_posix()} must contain an object")
        return None
    return value


def _require_string(
    payload: Mapping[str, Any],
    key: str,
    errors: list[str],
    prefix: str,
) -> str | None:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{prefix}.{key} must be a non-empty string")
        return None
    return value.strip()


def validate_plugin_manifest(repo_root: Path) -> list[str]:
    errors: list[str] = []
    manifest_path = repo_root / ".codex-plugin" / "plugin.json"
    manifest = _read_json_object(manifest_path, errors)
    if manifest is None:
        return errors

    name = _require_string(manifest, "name", errors, "plugin")
    version = _require_string(manifest, "version", errors, "plugin")
    _require_string(manifest, "description", errors, "plugin")
    if name and not PLUGIN_NAME_RE.fullmatch(name):
        errors.append("plugin.name has an invalid identifier")
    if version and not SEMVER_RE.fullmatch(version):
        errors.append("plugin.version must use strict semver")
    if manifest.get("skills") != "./skills/":
        errors.append("plugin.skills must be ./skills/")

    author = manifest.get("author")
    if not isinstance(author, dict):
        errors.append("plugin.author must be an object")
    else:
        _require_string(author, "name", errors, "plugin.author")

    interface = manifest.get("interface")
    if not isinstance(interface, dict):
        errors.append("plugin.interface must be an object")
    else:
        for field in (
            "displayName",
            "shortDescription",
            "longDescription",
            "developerName",
            "category",
        ):
            _require_string(interface, field, errors, "plugin.interface")
        capabilities = interface.get("capabilities")
        if not isinstance(capabilities, list) or not all(
            isinstance(item, str) and item.strip() for item in capabilities
        ):
            errors.append("plugin.interface.capabilities must be a string array")
        prompts = interface.get("defaultPrompt")
        if isinstance(prompts, str):
            prompts = [prompts]
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 3:
            errors.append("plugin.interface.defaultPrompt must contain one to three prompts")
        elif not all(isinstance(item, str) and 1 <= len(item) <= 128 for item in prompts):
            errors.append("plugin.interface.defaultPrompt entries must be non-empty and at most 128 characters")

    if "[TODO:" in json.dumps(manifest, ensure_ascii=False):
        errors.append("plugin manifest contains a TODO placeholder")
    return errors


def _frontmatter(text: str, path: Path, errors: list[str]) -> dict[str, str] | None:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.startswith("---\n"):
        errors.append(f"{path.as_posix()} is missing YAML frontmatter")
        return None
    end = normalized.find("\n---\n", 4)
    if end < 0:
        errors.append(f"{path.as_posix()} has unclosed YAML frontmatter")
        return None
    fields: dict[str, str] = {}
    for line in normalized[4:end].splitlines():
        if not line or line[0].isspace() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip().strip('"\'')
    return fields


def _relative_markdown_targets(text: str) -> Iterable[str]:
    for match in MARKDOWN_LINK_RE.finditer(text):
        raw = match.group(1).strip()
        if raw.startswith("<") and ">" in raw:
            raw = raw[1 : raw.index(">")]
        else:
            raw = raw.split(maxsplit=1)[0]
        target = raw.split("#", 1)[0]
        if not target or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target):
            continue
        if target.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", target):
            continue
        yield target


def _validate_agent_yaml(skill_root: Path, errors: list[str]) -> None:
    path = skill_root / "agents" / "openai.yaml"
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        errors.append(f"{path.as_posix()} is missing")
        return
    except (OSError, UnicodeDecodeError) as error:
        errors.append(f"cannot read {path.as_posix()}: {error}")
        return

    values: dict[str, str] = {}
    for field in ("display_name", "short_description", "default_prompt"):
        match = re.search(
            rf'^\s{{2}}{re.escape(field)}:\s*["\'](.+?)["\']\s*$',
            text,
            re.MULTILINE,
        )
        if not match:
            errors.append(f"{path.as_posix()} is missing interface.{field}")
        else:
            values[field] = match.group(1)
    short = values.get("short_description")
    if short is not None and not 25 <= len(short) <= 64:
        errors.append(f"{path.as_posix()} short_description must be 25 to 64 characters")
    prompt = values.get("default_prompt")
    if prompt is not None and f"${skill_root.name}" not in prompt:
        errors.append(f"{path.as_posix()} default_prompt must name ${skill_root.name}")


def validate_skills(repo_root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    skill_names: list[str] = []
    skills_root = repo_root / "skills"
    if not skills_root.is_dir():
        return ["skills directory is missing"], []

    for skill_root in sorted(skills_root.iterdir(), key=lambda path: path.name):
        if not skill_root.is_dir() or skill_root.name.startswith("."):
            continue
        skill_path = skill_root / "SKILL.md"
        if not skill_path.is_file():
            continue
        skill_names.append(skill_root.name)
        try:
            text = skill_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            errors.append(f"cannot read {skill_path.as_posix()}: {error}")
            continue
        fields = _frontmatter(text, skill_path, errors)
        if fields is None:
            continue
        name = fields.get("name")
        description = fields.get("description")
        if name != skill_root.name:
            errors.append(f"{skill_path.as_posix()} name must match its directory")
        if name is not None and not SKILL_NAME_RE.fullmatch(name):
            errors.append(f"{skill_path.as_posix()} has an invalid skill name")
        if not description:
            errors.append(f"{skill_path.as_posix()} is missing description")
        elif len(description) > 1024:
            errors.append(f"{skill_path.as_posix()} description exceeds 1024 characters")
        if "[TODO:" in text:
            errors.append(f"{skill_path.as_posix()} contains a TODO placeholder")

        for markdown in [skill_path, *sorted((skill_root / "references").glob("*.md"))]:
            try:
                markdown_text = markdown.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as error:
                errors.append(f"cannot read {markdown.as_posix()}: {error}")
                continue
            for target in _relative_markdown_targets(markdown_text):
                resolved = (markdown.parent / target).resolve()
                try:
                    resolved.relative_to(skill_root.resolve())
                except ValueError:
                    errors.append(f"{markdown.as_posix()} link escapes the skill: {target}")
                    continue
                if not resolved.exists():
                    errors.append(f"{markdown.as_posix()} has a missing link: {target}")
        _validate_agent_yaml(skill_root, errors)

    if not skill_names:
        errors.append("no skills were discovered")
    return errors, skill_names


def validate_repository(repo_root: Path) -> dict[str, Any]:
    plugin_errors = validate_plugin_manifest(repo_root)
    skill_errors, skills = validate_skills(repo_root)
    errors = plugin_errors + skill_errors
    return {
        "schemaVersion": 1,
        "ok": not errors,
        "skills": skills,
        "errors": errors,
    }
