"""Windows-native environment diagnostics driven by toolchains.json."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


EXIT_OK = 0
EXIT_ENVIRONMENT = 2
EXIT_CONTRACT = 3
EXIT_EXTERNAL = 4

RunCommand = Callable[[Sequence[str], int], subprocess.CompletedProcess[str]]
WhichCommand = Callable[[str], str | None]


def load_contract(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read toolchain contract: {error}") from error
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise ValueError("toolchain contract must be a schemaVersion 1 object")
    profiles = payload.get("profiles")
    tools = payload.get("tools")
    if not isinstance(profiles, dict) or not isinstance(tools, list):
        raise ValueError("toolchain contract requires profiles and tools")
    ids = [tool.get("id") for tool in tools if isinstance(tool, dict)]
    if len(ids) != len(tools) or any(not isinstance(item, str) for item in ids):
        raise ValueError("each tool requires a string id")
    if len(set(ids)) != len(ids):
        raise ValueError("tool ids must be unique")
    known = set(ids)
    for name, required in profiles.items():
        if not isinstance(name, str) or not isinstance(required, list):
            raise ValueError("each profile requires a list of tool ids")
        unknown = set(required) - known
        if unknown:
            raise ValueError(f"profile {name} references unknown tools: {sorted(unknown)}")
    return payload


def detect_platform() -> dict[str, str]:
    machine = platform.machine().lower()
    architecture = "x86_64" if machine in {"amd64", "x86_64"} else machine
    return {
        "os": "windows" if sys.platform == "win32" else sys.platform,
        "architecture": architecture,
        "release": platform.release(),
    }


def _default_run(args: Sequence[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        shell=False,
    )


def _version_tuple(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", value)
    return tuple(int(part) for part in parts)


def _version_at_least(actual: str, minimum: str) -> bool:
    left = _version_tuple(actual)
    right = _version_tuple(minimum)
    width = max(len(left), len(right))
    return left + (0,) * (width - len(left)) >= right + (0,) * (width - len(right))


def _candidate_commands(
    spec: Mapping[str, Any],
    environment: Mapping[str, str],
    which: WhichCommand,
) -> list[list[str]]:
    commands = spec.get("commands")
    if not isinstance(commands, list) or not commands:
        raise ValueError(f"tool {spec.get('id')} has no probe commands")

    result: list[list[str]] = []
    first_args = list(commands[0][1:])
    override_name = spec.get("overrideEnv")
    if isinstance(override_name, str) and environment.get(override_name):
        result.append([str(Path(environment[override_name]).expanduser()), *first_args])

    derived = spec.get("derivedCandidates", [])
    if not isinstance(derived, list):
        raise ValueError(f"tool {spec.get('id')} derivedCandidates must be a list")
    for item in derived:
        if not isinstance(item, dict):
            raise ValueError(f"tool {spec.get('id')} has an invalid derived candidate")
        env_name = item.get("env")
        relative = item.get("relative")
        if isinstance(env_name, str) and isinstance(relative, str) and environment.get(env_name):
            result.append([str(Path(environment[env_name]) / Path(relative)), *first_args])

    for command in commands:
        if not isinstance(command, list) or not command or not all(isinstance(arg, str) for arg in command):
            raise ValueError(f"tool {spec.get('id')} has an invalid command")
        executable = sys.executable if command[0] == "$python" else which(command[0])
        if executable:
            result.append([str(executable), *command[1:]])

    unique: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for command in result:
        key = tuple(part.casefold() for part in command)
        if key not in seen:
            seen.add(key)
            unique.append(command)
    return unique


def _run_probe(
    args: Sequence[str],
    run: RunCommand,
    timeout: int,
) -> tuple[subprocess.CompletedProcess[str] | None, str | None]:
    try:
        return run(args, timeout), None
    except subprocess.TimeoutExpired:
        return None, f"probe timed out after {timeout}s"
    except (OSError, PermissionError) as error:
        return None, str(error)


def probe_tool(
    spec: Mapping[str, Any],
    required: bool,
    *,
    environment: Mapping[str, str] | None = None,
    which: WhichCommand = shutil.which,
    run: RunCommand = _default_run,
    timeout: int = 15,
) -> dict[str, Any]:
    env = os.environ if environment is None else environment
    commands = _candidate_commands(spec, env, which)
    failures: list[str] = []
    if not commands:
        return {
            "id": spec["id"],
            "label": spec.get("label", spec["id"]),
            "required": required,
            "status": "missing",
            "path": None,
            "version": None,
            "minimumVersion": spec.get("minimumVersion"),
            "installHint": spec.get("installHint"),
            "detail": "no executable candidate resolved",
        }

    for command in commands:
        completed, error = _run_probe(command, run, timeout)
        if completed is None:
            failures.append(f"{command[0]}: {error}")
            continue
        output = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
        if completed.returncode != 0:
            failures.append(f"{command[0]}: exit {completed.returncode}: {output[:240]}")
            continue

        version = None
        pattern = spec.get("versionRegex")
        if isinstance(pattern, str):
            match = re.search(pattern, output, re.IGNORECASE | re.DOTALL)
            if match:
                version = match.group(1)
            else:
                failures.append(f"{command[0]}: version output did not match contract")
                continue

        minimum = spec.get("minimumVersion")
        if isinstance(minimum, str) and version is not None and not _version_at_least(version, minimum):
            return {
                "id": spec["id"],
                "label": spec.get("label", spec["id"]),
                "required": required,
                "status": "version_too_old",
                "path": str(Path(command[0]).resolve()),
                "version": version,
                "minimumVersion": minimum,
                "installHint": spec.get("installHint"),
                "detail": f"requires >= {minimum}",
            }

        capability_failures: list[str] = []
        for capability in spec.get("capabilityCommands", []):
            cap_args = list(capability)
            cap_args[0] = command[0]
            cap_result, cap_error = _run_probe(cap_args, run, timeout)
            if cap_result is None:
                capability_failures.append(cap_error or "capability probe failed")
            elif cap_result.returncode != 0:
                capability_failures.append(
                    f"exit {cap_result.returncode}: {(cap_result.stdout + cap_result.stderr)[:240]}"
                )
        if capability_failures:
            return {
                "id": spec["id"],
                "label": spec.get("label", spec["id"]),
                "required": required,
                "status": "capability_missing",
                "path": str(Path(command[0]).resolve()),
                "version": version,
                "minimumVersion": minimum,
                "installHint": spec.get("installHint"),
                "detail": "; ".join(capability_failures),
            }

        return {
            "id": spec["id"],
            "label": spec.get("label", spec["id"]),
            "required": required,
            "status": "ok",
            "path": str(Path(command[0]).resolve()),
            "version": version,
            "minimumVersion": minimum,
            "installHint": spec.get("installHint"),
            "detail": None,
        }

    return {
        "id": spec["id"],
        "label": spec.get("label", spec["id"]),
        "required": required,
        "status": "unusable",
        "path": commands[0][0],
        "version": None,
        "minimumVersion": spec.get("minimumVersion"),
        "installHint": spec.get("installHint"),
        "detail": "; ".join(failures),
    }


def _ascend(path: Path, count: int) -> Path:
    result = path
    for _ in range(count):
        result = result.parent
    return result


def _unique_paths(paths: Sequence[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path).casefold()
        if key not in seen:
            seen.add(key)
            result.append(path)
    return result


def inspect_chisel_runtime(
    contract: Mapping[str, Any],
    tool_results: Sequence[Mapping[str, Any]],
    *,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    settings = contract.get("chiselRuntime")
    if not isinstance(settings, dict):
        raise ValueError("toolchain contract requires chiselRuntime")
    env = os.environ if environment is None else environment
    tools = {item["id"]: item for item in tool_results}

    candidates: list[Path] = []
    searched: list[str] = []
    root_env = settings.get("rootEnv")
    if isinstance(root_env, str) and env.get(root_env):
        candidates.append(Path(env[root_env]).expanduser())

    anchor_id = settings.get("deriveRootFromTool")
    anchor_parents = settings.get("deriveRootParents")
    anchor = tools.get(anchor_id) if isinstance(anchor_id, str) else None
    if (
        isinstance(anchor, Mapping)
        and anchor.get("status") == "ok"
        and isinstance(anchor.get("path"), str)
        and isinstance(anchor_parents, int)
        and anchor_parents >= 1
    ):
        candidates.append(_ascend(Path(anchor["path"]), anchor_parents))
    candidates = _unique_paths(candidates)

    required_paths = settings.get("requiredPaths")
    if not isinstance(required_paths, list) or not required_paths:
        raise ValueError("chiselRuntime requires requiredPaths")
    normalized: list[dict[str, str]] = []
    for item in required_paths:
        if not isinstance(item, dict):
            raise ValueError("chiselRuntime requiredPaths entries must be objects")
        item_id = item.get("id")
        relative = item.get("relative")
        kind = item.get("kind")
        if not isinstance(item_id, str) or not isinstance(relative, str):
            raise ValueError("each chiselRuntime path requires id and relative")
        if kind not in {"file", "directory"}:
            raise ValueError(f"chiselRuntime path {item_id} has invalid kind")
        normalized.append(
            {
                "id": item_id,
                "label": str(item.get("label", item_id)),
                "relative": relative,
                "kind": kind,
                "installHint": str(item.get("installHint", "")),
            }
        )

    selected_root: Path | None = None
    for candidate in candidates:
        searched.append(str(candidate))
        if all(
            (candidate / item["relative"]).is_file()
            if item["kind"] == "file"
            else (candidate / item["relative"]).is_dir()
            for item in normalized
        ):
            selected_root = candidate.resolve()
            break

    results: list[dict[str, Any]] = []
    if selected_root is None:
        search_text = ", ".join(searched) if searched else "no MSYS2 root candidate"
        root_instruction = f"set {root_env}" if isinstance(root_env, str) else "configure an MSYS2 root"
        for item in normalized:
            expected = candidates[0] / item["relative"] if candidates else None
            results.append(
                {
                    "id": item["id"],
                    "label": item["label"],
                    "required": True,
                    "status": "missing",
                    "path": str(expected) if expected is not None else None,
                    "version": None,
                    "minimumVersion": None,
                    "installHint": item["installHint"] or root_instruction,
                    "detail": f"required Chisel runtime companion was not found; searched: {search_text}",
                }
            )
        return {
            "ok": False,
            "root": None,
            "searchedRoots": searched,
            "pathPrepend": [],
            "environmentOverrides": {},
            "environmentUnset": [],
            "tools": results,
        }

    resolved_paths = {
        item["id"]: selected_root / item["relative"] for item in normalized
    }
    for item in normalized:
        results.append(
            {
                "id": item["id"],
                "label": item["label"],
                "required": True,
                "status": "ok",
                "path": str(resolved_paths[item["id"]]),
                "version": None,
                "minimumVersion": None,
                "installHint": item["installHint"] or None,
                "detail": None,
            }
        )

    path_entries = settings.get("pathPrepend")
    if not isinstance(path_entries, list) or not all(
        isinstance(item, str) for item in path_entries
    ):
        raise ValueError("chiselRuntime pathPrepend must be a list of paths")
    prepend = [selected_root / item for item in path_entries]
    for tool_id in ("java", "sbt", "verilator", "cxx", "make"):
        tool = tools.get(tool_id)
        if isinstance(tool, Mapping) and isinstance(tool.get("path"), str):
            prepend.append(Path(tool["path"]).parent)

    overrides_spec = settings.get("environmentOverrides")
    if not isinstance(overrides_spec, dict):
        raise ValueError("chiselRuntime environmentOverrides must be an object")
    overrides: dict[str, str] = {}
    for name, relative in overrides_spec.items():
        if not isinstance(name, str) or not isinstance(relative, str):
            raise ValueError("chiselRuntime environmentOverrides must map strings to paths")
        overrides[name] = str(selected_root / relative)
    unset = settings.get("environmentUnset", [])
    if not isinstance(unset, list) or not all(isinstance(item, str) for item in unset):
        raise ValueError("chiselRuntime environmentUnset must be a list of names")

    return {
        "ok": True,
        "root": str(selected_root),
        "searchedRoots": searched,
        "pathPrepend": [str(path) for path in _unique_paths(prepend)],
        "environmentOverrides": overrides,
        "environmentUnset": unset,
        "tools": results,
    }


def diagnose(
    contract: Mapping[str, Any],
    profile: str,
    *,
    environment: Mapping[str, str] | None = None,
    which: WhichCommand = shutil.which,
    run: RunCommand = _default_run,
) -> dict[str, Any]:
    profiles = contract["profiles"]
    if profile not in profiles:
        raise ValueError(f"unknown profile: {profile}")
    selected_ids = profiles[profile]
    specifications = {spec["id"]: spec for spec in contract["tools"]}
    platform_info = detect_platform()
    supported = (
        platform_info["os"] in contract.get("supportedPlatforms", [])
        and platform_info["architecture"] == contract.get("architecture")
    )
    results = [
        probe_tool(
            specifications[tool_id],
            True,
            environment=environment,
            which=which,
            run=run,
        )
        for tool_id in selected_ids
    ]
    runtimes: dict[str, Any] = {}
    chisel_settings = contract.get("chiselRuntime")
    if isinstance(chisel_settings, dict) and profile in chisel_settings.get(
        "profiles", []
    ):
        chisel_runtime = inspect_chisel_runtime(
            contract,
            results,
            environment=environment,
        )
        results.extend(chisel_runtime["tools"])
        runtimes["chisel"] = {
            key: value for key, value in chisel_runtime.items() if key != "tools"
        }
    required_failures = [
        item["id"] for item in results if item["required"] and item["status"] != "ok"
    ]
    if not supported:
        required_failures.insert(0, "platform")
    return {
        "schemaVersion": 1,
        "ok": supported and not required_failures,
        "profile": profile,
        "platform": platform_info,
        "supportedPlatform": supported,
        "requiredFailures": required_failures,
        "tools": results,
        "runtimes": runtimes,
    }


def render_human(report: Mapping[str, Any]) -> str:
    state = "通过" if report["ok"] else "失败"
    lines = [
        f"环境诊断: {state}",
        f"Profile: {report['profile']}",
        f"平台: {report['platform']['os']} {report['platform']['architecture']}",
    ]
    utf8_text = report.get("utf8Text")
    if isinstance(utf8_text, Mapping):
        encoding_state = "OK" if utf8_text.get("ok") else "INVALID"
        lines.append(
            f"[{encoding_state}] UTF-8 文本读取 [{utf8_text.get('path')}]"
        )
        if utf8_text.get("detail"):
            lines.append(f"  诊断: {utf8_text['detail']}")
    labels = {
        "ok": "OK",
        "missing": "MISSING",
        "unusable": "UNUSABLE",
        "version_too_old": "OLD",
        "capability_missing": "CAPABILITY",
    }
    for tool in report["tools"]:
        required = "required" if tool["required"] else "optional"
        version = f" {tool['version']}" if tool.get("version") else ""
        path = f" [{tool['path']}]" if tool.get("path") else ""
        lines.append(
            f"[{labels.get(tool['status'], tool['status'].upper())}] "
            f"{tool['label']} ({required}){version}{path}"
        )
        if tool["status"] != "ok":
            if tool.get("detail"):
                lines.append(f"  诊断: {tool['detail']}")
            if tool.get("installHint"):
                lines.append(f"  恢复: {tool['installHint']}")
    return "\n".join(lines)


def render_json(report: Mapping[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
