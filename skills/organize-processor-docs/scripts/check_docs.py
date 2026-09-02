#!/usr/bin/env python3
"""Check human-first processor documentation structure and provisional budgets."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping
from urllib.parse import unquote


@dataclass(frozen=True)
class Budget:
    target_effective_chars: int
    target_non_blank_lines: int
    hard_effective_chars: int
    hard_non_blank_lines: int


DEFAULT_BUDGETS = {
    "readme": Budget(2500, 60, 4000, 100),
    "architecture": Budget(6000, 140, 10000, 200),
    "design": Budget(8000, 180, 12000, 250),
    "verification": Budget(6000, 150, 10000, 220),
    "research": Budget(6000, 150, 10000, 220),
    "finding": Budget(2500, 60, 4000, 100),
    "adr": Budget(2500, 60, 4000, 100),
    "generic": Budget(8000, 180, 12000, 250),
}
HARD_LIMIT_POLICIES = {"warn", "error", "off"}

ROOT_KINDS = ("architecture", "design", "verification", "research")
FORBIDDEN_COMPONENTS = {
    "finaldesign",
    "newdesign",
    "designv2",
    "designbackup",
}
RASTER_DIAGRAM_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
EVIDENCE_CAPTURE_COMPONENTS = {
    ".runtime",
    "capture",
    "captures",
    "evidence",
    "report",
    "reports",
    "result",
    "results",
    "run",
    "runs",
    "runtime",
    "screenshot",
    "screenshots",
    "waveform",
    "waveforms",
}
EDITABLE_DIAGRAM_SUFFIXES = {
    ".drawio",
    ".svg",
    ".mmd",
    ".dot",
    ".puml",
    ".plantuml",
    ".py",
}

INLINE_LINK_RE = re.compile(
    r"(?P<image>!)?\[[^\]]*\]\(\s*(?P<target><[^>]+>|[^\s)]+)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)
REFERENCE_LINK_RE = re.compile(
    r"(?P<image>!)?\[(?P<label>[^\]]*)\]\[(?P<ref>[^\]]*)\]"
)
REFERENCE_DEF_RE = re.compile(
    r"^\s*\[(?P<ref>[^\]]+)\]:\s*(?P<target><[^>]+>|\S+)"
)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(?P<title>.+?)\s*#*\s*$")
EXPLICIT_ID_RE = re.compile(
    r"<(?:a|span)\s+(?:[^>]*?\s)?(?:id|name)=[\"'](?P<id>[^\"']+)[\"'][^>]*>",
    re.IGNORECASE,
)
WINDOWS_ABSOLUTE_RE = re.compile(r"^[A-Za-z]:[\\/]")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
CONFLICT_RE = re.compile(r"^(?:<<<<<<<|>>>>>>>)")


def path_text(path: Path, project: Path) -> str:
    try:
        return path.relative_to(project).as_posix()
    except ValueError:
        return str(path)


def configure_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def issue(
    code: str,
    path: Path,
    project: Path,
    message: str,
    line: int | None = None,
    severity: str = "error",
) -> dict[str, object]:
    result: dict[str, object] = {
        "code": code,
        "path": path_text(path, project),
        "message": message,
        "severity": severity,
    }
    if line is not None:
        result["line"] = line
    return result


def read_markdown_text(
    path: Path,
    project: Path,
    issues: list[dict[str, object]],
    cache: dict[Path, str],
    failed_paths: set[Path],
) -> str | None:
    path = path.resolve()
    if path in cache:
        return cache[path]
    if path in failed_paths:
        return None

    try:
        data = path.read_bytes()
    except OSError as error:
        failed_paths.add(path)
        issues.append(
            issue(
                "read_error",
                path,
                project,
                f"Cannot read Markdown file: {error}",
            )
        )
        return None

    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        failed_paths.add(path)
        issues.append(
            issue(
                "encoding_error",
                path,
                project,
                "Markdown uses UTF-16; convert it to UTF-8",
            )
        )
        return None

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        failed_paths.add(path)
        issues.append(
            issue(
                "encoding_error",
                path,
                project,
                f"Markdown is not valid UTF-8: {error.reason}",
            )
        )
        return None

    if "\x00" in text:
        failed_paths.add(path)
        issues.append(
            issue(
                "encoding_error",
                path,
                project,
                "Markdown contains NUL bytes and is likely stored in a non-UTF-8 encoding",
            )
        )
        return None

    cache[path] = text
    return text


def lines_outside_fences(text: str) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    fence_char: str | None = None
    fence_len = 0

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        match = re.match(r"(`{3,}|~{3,})", stripped)
        if match:
            marker = match.group(1)
            if fence_char is None:
                fence_char = marker[0]
                fence_len = len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_len:
                fence_char = None
                fence_len = 0
            result.append((line_number, ""))
            continue

        result.append((line_number, line if fence_char is None else ""))

    return result


def github_slug(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.strip().lower()

    kept: list[str] = []
    for character in text:
        category = unicodedata.category(character)
        if character.isspace():
            kept.append("-")
        elif character in "-_":
            kept.append(character)
        elif category[0] in {"L", "N", "M"}:
            kept.append(character)

    return "".join(kept)


def markdown_anchors(
    path: Path,
    cache: dict[Path, set[str]],
    project: Path,
    issues: list[dict[str, object]],
    text_cache: dict[Path, str],
    failed_paths: set[Path],
) -> set[str] | None:
    if path in cache:
        return cache[path]

    text = read_markdown_text(path, project, issues, text_cache, failed_paths)
    if text is None:
        return None
    anchors: set[str] = set()
    slug_counts: dict[str, int] = {}

    for _, line in lines_outside_fences(text):
        for match in EXPLICIT_ID_RE.finditer(line):
            anchors.add(unquote(match.group("id")).lower())

        heading = HEADING_RE.match(line)
        if not heading:
            continue

        base = github_slug(heading.group("title"))
        if not base:
            continue
        count = slug_counts.get(base, 0)
        slug_counts[base] = count + 1
        anchors.add(base if count == 0 else f"{base}-{count}")

    cache[path] = anchors
    return anchors


def parse_links(text: str) -> list[tuple[int, str, bool]]:
    visible_lines = lines_outside_fences(text)
    definitions: dict[str, str] = {}

    for _, line in visible_lines:
        definition = REFERENCE_DEF_RE.match(line)
        if definition:
            definitions[definition.group("ref").strip().lower()] = definition.group(
                "target"
            )

    links: list[tuple[int, str, bool]] = []
    for line_number, line in visible_lines:
        if REFERENCE_DEF_RE.match(line):
            continue

        for match in INLINE_LINK_RE.finditer(line):
            links.append(
                (line_number, match.group("target"), bool(match.group("image")))
            )

        for match in REFERENCE_LINK_RE.finditer(line):
            reference = (match.group("ref") or match.group("label")).strip().lower()
            target = definitions.get(reference)
            if target:
                links.append((line_number, target, bool(match.group("image"))))

    return links


def clean_target(target: str) -> str:
    target = target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    return target.replace("\\ ", " ")


def is_external_target(target: str) -> bool:
    if WINDOWS_ABSOLUTE_RE.match(target):
        return False
    return bool(SCHEME_RE.match(target))


def within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def resolve_local_target(
    source: Path,
    raw_target: str,
    project: Path,
    line_number: int,
    issues: list[dict[str, object]],
    anchor_cache: dict[Path, set[str]],
    text_cache: dict[Path, str],
    failed_paths: set[Path],
) -> Path | None:
    target = clean_target(raw_target)
    if not target:
        return None

    if target.lower().startswith("file:") or WINDOWS_ABSOLUTE_RE.match(target):
        issues.append(
            issue(
                "absolute_local_link",
                source,
                project,
                f"Use a project-relative link instead of {target!r}",
                line_number,
            )
        )
        return None

    if is_external_target(target):
        return None

    path_part, separator, fragment = target.partition("#")
    path_part = unquote(path_part.split("?", 1)[0])
    fragment = unquote(fragment) if separator else ""

    if path_part.startswith("/"):
        issues.append(
            issue(
                "absolute_local_link",
                source,
                project,
                f"Use a project-relative link instead of {target!r}",
                line_number,
            )
        )
        return None

    resolved = source if not path_part else (source.parent / path_part).resolve()
    if not within(resolved, project):
        issues.append(
            issue(
                "outside_project_link",
                source,
                project,
                f"Local link escapes the project: {target!r}",
                line_number,
            )
        )
        return None

    if resolved.is_dir():
        readmes = [
            candidate
            for candidate in resolved.iterdir()
            if candidate.is_file() and candidate.name.lower() == "readme.md"
        ]
        if len(readmes) == 1:
            resolved = readmes[0]

    if not resolved.exists():
        issues.append(
            issue(
                "broken_link",
                source,
                project,
                f"Local target does not exist: {target!r}",
                line_number,
            )
        )
        return None

    if fragment and resolved.is_file() and resolved.suffix.lower() == ".md":
        fragment_key = fragment.lower()
        anchors = markdown_anchors(
            resolved,
            anchor_cache,
            project,
            issues,
            text_cache,
            failed_paths,
        )
        if anchors is not None and fragment_key not in anchors:
            issues.append(
                issue(
                    "broken_anchor",
                    source,
                    project,
                    f"Markdown anchor does not exist: {target!r}",
                    line_number,
                )
            )

    return resolved


def is_adr(path: Path) -> bool:
    if any(part.lower() == "adr" for part in path.parts):
        return True
    stem = path.stem.lower()
    return bool(re.search(r"(?:^|[-_])adr(?:$|[-_])", stem))


def is_finding(path: Path) -> bool:
    if any(part.lower() in {"finding", "findings"} for part in path.parts):
        return True
    stem = path.stem.lower()
    return bool(re.search(r"(?:^|[-_])finding(?:$|[-_])", stem))


def is_duplicate_tree_component(name: str) -> bool:
    lowered = name.lower()
    compact = re.sub(r"[\s_.()\-]+", "", lowered)
    if compact in FORBIDDEN_COMPONENTS or "backup" in compact:
        return True
    return bool(
        re.match(r"^old(?:$|[\s_.()\-])", lowered)
        or re.search(r"\(old\)$", lowered)
    )


def is_parallel_design_root(name: str) -> bool:
    compact = re.sub(r"[\s_.()\-]+", "", name.lower())
    if compact == "design":
        return False
    if compact in FORBIDDEN_COMPONENTS:
        return True
    return bool(
        re.fullmatch(
            r"(?:candidate|final|new|old)?design"
            r"(?:backup|candidate|final|new|old|v\d+)?",
            compact,
        )
    )


def has_editable_diagram_source(path: Path) -> bool:
    if path.suffix.lower() not in RASTER_DIAGRAM_SUFFIXES:
        return True
    return any(path.with_suffix(suffix).is_file() for suffix in EDITABLE_DIAGRAM_SUFFIXES)


def is_evidence_capture(source: Path, image: Path, project: Path) -> bool:
    source_relative = source.relative_to(project)
    image_relative = image.relative_to(project)
    components = {
        part.lower()
        for part in (
            *source_relative.parent.parts,
            source_relative.stem,
            *image_relative.parent.parts,
            image_relative.stem,
        )
    }
    return bool(components & EVIDENCE_CAPTURE_COMPONENTS)


def document_profile(path: Path, root_kind: str) -> str:
    if path.name.lower() == "readme.md":
        return "readme"
    if is_adr(path):
        return "adr"
    if is_finding(path):
        return "finding"
    if root_kind in DEFAULT_BUDGETS:
        return root_kind
    return "generic"


def resolved_budgets(
    overrides: Mapping[str, Mapping[str, int]] | None,
) -> dict[str, Budget]:
    budgets = dict(DEFAULT_BUDGETS)
    if not overrides:
        return budgets

    field_names = {
        "targetEffectiveChars": "target_effective_chars",
        "targetNonBlankLines": "target_non_blank_lines",
        "hardEffectiveChars": "hard_effective_chars",
        "hardNonBlankLines": "hard_non_blank_lines",
    }
    for profile, values in overrides.items():
        if profile not in budgets:
            raise ValueError(f"Unknown budget profile: {profile}")
        if not isinstance(values, Mapping):
            raise ValueError(f"Budget profile {profile!r} must be an object")

        current = budgets[profile]
        updated = {
            "target_effective_chars": current.target_effective_chars,
            "target_non_blank_lines": current.target_non_blank_lines,
            "hard_effective_chars": current.hard_effective_chars,
            "hard_non_blank_lines": current.hard_non_blank_lines,
        }
        for key, value in values.items():
            if key not in field_names:
                raise ValueError(f"Unknown budget field for {profile}: {key}")
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"Budget field {profile}.{key} must be a positive integer")
            updated[field_names[key]] = value

        if updated["target_effective_chars"] > updated["hard_effective_chars"]:
            raise ValueError(
                f"Target effective characters exceed hard threshold for {profile}"
            )
        if updated["target_non_blank_lines"] > updated["hard_non_blank_lines"]:
            raise ValueError(
                f"Target nonblank lines exceed hard threshold for {profile}"
            )
        budgets[profile] = Budget(**updated)

    return budgets


def append_budget_finding(
    issues: list[dict[str, object]],
    path: Path,
    project: Path,
    profile: str,
    metric_name: str,
    measured: int,
    target: int,
    hard: int,
    hard_limit_policy: str,
) -> None:
    if measured > hard and hard_limit_policy != "off":
        severity = "error" if hard_limit_policy == "error" else "warning"
        issues.append(
            issue(
                f"hard_{metric_name}_exceeded",
                path,
                project,
                f"{measured} exceeds the provisional {profile} hard threshold of {hard}",
                severity=severity,
            )
        )
    elif measured > target:
        issues.append(
            issue(
                f"target_{metric_name}_exceeded",
                path,
                project,
                f"{measured} exceeds the {profile} target of {target}; perform a concision review",
                severity="warning",
            )
        )


def find_entry(root: Path) -> Path | None:
    entries = [
        path
        for path in root.iterdir()
        if path.is_file() and path.name.lower() == "readme.md"
    ]
    return entries[0] if len(entries) == 1 else None


def auto_roots(project: Path) -> list[tuple[Path, str]]:
    by_name = {
        path.name.lower(): path for path in project.iterdir() if path.is_dir()
    }
    return [(by_name[kind], kind) for kind in ROOT_KINDS if kind in by_name]


def requested_roots(project: Path, roots: Iterable[str]) -> list[tuple[Path, str]]:
    result: list[tuple[Path, str]] = []
    for root_arg in roots:
        path = Path(root_arg)
        if not path.is_absolute():
            path = project / path
        path = path.resolve()
        kind = path.name.lower()
        result.append((path, kind if kind in ROOT_KINDS else "generic"))
    return result


def check_project(
    project: Path,
    root_args: Iterable[str] | None = None,
    *,
    hard_limit_policy: str = "warn",
    budget_overrides: Mapping[str, Mapping[str, int]] | None = None,
) -> dict[str, object]:
    project = project.resolve()
    if hard_limit_policy not in HARD_LIMIT_POLICIES:
        raise ValueError(f"Unknown hard-limit policy: {hard_limit_policy}")
    budgets = resolved_budgets(budget_overrides)
    issues: list[dict[str, object]] = []
    measurements: list[dict[str, object]] = []
    anchor_cache: dict[Path, set[str]] = {}
    text_cache: dict[Path, str] = {}
    failed_paths: set[Path] = set()
    links_by_source: dict[Path, set[Path]] = {}

    roots = (
        requested_roots(project, root_args or [])
        if root_args
        else auto_roots(project)
    )

    if not roots:
        issues.append(
            issue(
                "no_document_roots",
                project,
                project,
                "No Architecture, Design, Verification, or Research document root was found",
            )
        )

    for directory in sorted(path for path in project.iterdir() if path.is_dir()):
        if is_parallel_design_root(directory.name):
            issues.append(
                issue(
                    "duplicate_current_tree",
                    directory,
                    project,
                    "Parallel candidate, backup, old, or versioned Design root is forbidden",
                )
            )

    all_files: list[Path] = []
    valid_roots: list[tuple[Path, str]] = []

    for root, kind in roots:
        if not root.exists() or not root.is_dir():
            issues.append(
                issue(
                    "missing_root",
                    root,
                    project,
                    "Requested document root does not exist",
                )
            )
            continue
        if not within(root, project):
            issues.append(
                issue(
                    "outside_project_root",
                    root,
                    project,
                    "Document root must be inside the project",
                )
            )
            continue

        valid_roots.append((root, kind))
        files = sorted(path.resolve() for path in root.rglob("*.md") if path.is_file())
        all_files.extend(files)

        if find_entry(root) is None:
            issues.append(
                issue(
                    "missing_entry",
                    root,
                    project,
                    "Document root must contain exactly one README.md entry",
                )
            )

        for directory in (path for path in root.rglob("*") if path.is_dir()):
            if kind != "research" and is_duplicate_tree_component(directory.name):
                issues.append(
                    issue(
                        "duplicate_current_tree",
                        directory,
                        project,
                        "Backup or duplicate-current document directory is forbidden",
                    )
                )

        for path in files:
            links_by_source.setdefault(path, set())
            text = read_markdown_text(
                path,
                project,
                issues,
                text_cache,
                failed_paths,
            )
            if text is None:
                continue
            effective_chars = sum(1 for character in text if not character.isspace())
            non_blank_lines = sum(1 for line in text.splitlines() if line.strip())
            profile = document_profile(path, kind)
            budget = budgets[profile]

            measurements.append(
                {
                    "path": path_text(path, project),
                    "profile": profile,
                    "effectiveChars": effective_chars,
                    "nonBlankLines": non_blank_lines,
                    "targetEffectiveChars": budget.target_effective_chars,
                    "targetNonBlankLines": budget.target_non_blank_lines,
                    "hardEffectiveChars": budget.hard_effective_chars,
                    "hardNonBlankLines": budget.hard_non_blank_lines,
                }
            )

            append_budget_finding(
                issues,
                path,
                project,
                profile,
                "effective_chars",
                effective_chars,
                budget.target_effective_chars,
                budget.hard_effective_chars,
                hard_limit_policy,
            )
            append_budget_finding(
                issues,
                path,
                project,
                profile,
                "non_blank_lines",
                non_blank_lines,
                budget.target_non_blank_lines,
                budget.hard_non_blank_lines,
                hard_limit_policy,
            )

            for line_number, line in enumerate(text.splitlines(), start=1):
                if CONFLICT_RE.match(line):
                    issues.append(
                        issue(
                            "conflict_marker",
                            path,
                            project,
                            "Unresolved merge conflict marker",
                            line_number,
                        )
                    )

            for line_number, target, is_image in parse_links(text):
                resolved = resolve_local_target(
                    path,
                    target,
                    project,
                    line_number,
                    issues,
                    anchor_cache,
                    text_cache,
                    failed_paths,
                )
                if (
                    resolved
                    and is_image
                    and resolved.is_file()
                    and resolved.suffix.lower() in RASTER_DIAGRAM_SUFFIXES
                    and not is_evidence_capture(path, resolved, project)
                    and not has_editable_diagram_source(resolved)
                ):
                    issues.append(
                        issue(
                            "missing_editable_diagram_source",
                            path,
                            project,
                            f"Explanatory raster diagram lacks a same-stem editable source: {target!r}",
                            line_number,
                        )
                    )
                if resolved and resolved.is_file() and resolved.suffix.lower() == ".md":
                    links_by_source[path].add(resolved.resolve())

    for root, kind in valid_roots:
        entry = find_entry(root)
        if entry is None:
            continue
        entry = entry.resolve()
        root_files = {
            path.resolve() for path in root.rglob("*.md") if path.is_file()
        }
        depths: dict[Path, int] = {entry: 0}
        queue: deque[Path] = deque([entry])

        while queue:
            current = queue.popleft()
            for target in links_by_source.get(current, set()):
                if target in root_files and target not in depths:
                    depths[target] = depths[current] + 1
                    queue.append(target)

        reached = set(depths)
        for orphan in sorted(root_files - reached):
            issues.append(
                issue(
                    "orphan_document",
                    orphan,
                    project,
                    f"Document is not reachable from {path_text(entry, project)}",
                )
            )

        if kind in {"architecture", "design"}:
            for deep_path, depth in sorted(
                depths.items(), key=lambda item: path_text(item[0], project)
            ):
                if depth <= 2:
                    continue
                issues.append(
                    issue(
                        "reading_path_too_deep",
                        deep_path,
                        project,
                        f"Shortest reading path from {path_text(entry, project)} is {depth} links; maximum is 2",
                    )
                )

    issues.sort(
        key=lambda item: (
            str(item.get("path", "")),
            int(item.get("line", 0)),
            str(item.get("code", "")),
        )
    )
    measurements.sort(key=lambda item: str(item["path"]))

    error_count = sum(1 for item in issues if item["severity"] == "error")
    warning_count = sum(1 for item in issues if item["severity"] == "warning")

    return {
        "project": str(project),
        "roots": [path_text(root, project) for root, _ in valid_roots],
        "filesChecked": len(set(all_files)),
        "hardLimitPolicy": hard_limit_policy,
        "measurements": measurements,
        "issues": issues,
        "errorCount": error_count,
        "warningCount": warning_count,
        "ok": error_count == 0,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check processor documentation links, reading depth, conflicts, encoding, and provisional length budgets."
    )
    parser.add_argument(
        "project",
        nargs="?",
        default=".",
        help="Project root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--root",
        action="append",
        default=[],
        help="Document root relative to the project. Repeat for custom roots.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON report.",
    )
    parser.add_argument(
        "--hard-limit-policy",
        choices=sorted(HARD_LIMIT_POLICIES),
        default="warn",
        help="How provisional hard thresholds behave. Defaults to warn.",
    )
    parser.add_argument(
        "--budget-config",
        help="UTF-8 JSON file with per-profile provisional budget overrides.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_utf8_output()
    parser = build_parser()
    args = parser.parse_args(argv)
    budget_overrides = None
    if args.budget_config:
        try:
            config_text = Path(args.budget_config).read_text(encoding="utf-8-sig")
            budget_overrides = json.loads(config_text)
            if not isinstance(budget_overrides, dict):
                raise ValueError("Budget configuration must be a JSON object")
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            parser.error(f"invalid --budget-config: {error}")

    try:
        report = check_project(
            Path(args.project),
            args.root,
            hard_limit_policy=args.hard_limit_policy,
            budget_overrides=budget_overrides,
        )
    except ValueError as error:
        parser.error(str(error))

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif report["ok"] and not report["issues"]:
        print(
            f"OK: checked {report['filesChecked']} Markdown files in "
            f"{len(report['roots'])} document roots."
        )
    else:
        issues = report["issues"]
        label = "WARN" if report["ok"] else "FAIL"
        print(
            f"{label}: {report['errorCount']} error(s), "
            f"{report['warningCount']} warning(s)."
        )
        for item in issues:
            location = str(item["path"])
            if "line" in item:
                location += f":{item['line']}"
            print(
                f"{item['severity']}: {item['code']}: "
                f"{location}: {item['message']}"
            )

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
