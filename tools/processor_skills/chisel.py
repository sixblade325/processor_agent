"""Process-scoped Windows environment and command runner for Chisel tools."""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


CommandRunner = Callable[
    [Sequence[str], Path, Mapping[str, str]], subprocess.CompletedProcess[str]
]


def _tool_path(doctor_report: Mapping[str, Any], tool_id: str) -> Path:
    tool = next(
        (
            item
            for item in doctor_report.get("tools", [])
            if item.get("id") == tool_id and item.get("status") == "ok"
        ),
        None,
    )
    if not isinstance(tool, Mapping) or not isinstance(tool.get("path"), str):
        raise ValueError(f"doctor did not resolve required tool: {tool_id}")
    return Path(tool["path"]).resolve()


def _runtime_directory(repo_root: Path, contract: Mapping[str, Any]) -> Path:
    relative = contract.get("runtimeDirectory")
    if not isinstance(relative, str) or not relative:
        raise ValueError("toolchain contract requires runtimeDirectory")
    configured = Path(relative)
    if configured.is_absolute():
        raise ValueError("runtimeDirectory must be relative to the package root")
    root = repo_root.resolve()
    runtime = (root / configured).resolve()
    if not runtime.is_relative_to(root):
        raise ValueError("runtimeDirectory escapes the package root")
    return runtime


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _compile_adapter(
    compiler: Path,
    source: Path,
    output: Path,
    *,
    extra_flags: Sequence[str] = (),
) -> str:
    if not source.is_file():
        raise ValueError(f"native adapter source is missing: {source}")
    fingerprint = hashlib.sha256()
    fingerprint.update(source.read_bytes())
    fingerprint.update(str(compiler).casefold().encode("utf-8"))
    for flag in extra_flags:
        fingerprint.update(b"\0")
        fingerprint.update(flag.encode("utf-8"))
    expected = fingerprint.hexdigest()
    marker = output.with_suffix(output.suffix + ".sha256")
    if output.is_file() and marker.is_file():
        try:
            if marker.read_text(encoding="ascii").strip() == expected:
                return "cached"
        except OSError:
            pass

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".tmp" + output.suffix)
    temporary.unlink(missing_ok=True)
    command = [
        str(compiler),
        "-std=c++17",
        "-O2",
        *extra_flags,
        str(source),
        "-o",
        str(temporary),
    ]
    completed = subprocess.run(
        command,
        cwd=source.parent,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    if completed.returncode != 0:
        temporary.unlink(missing_ok=True)
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(
            f"cannot build native Chisel adapter {source.name}: "
            f"exit {completed.returncode}: {detail[:1200]}"
        )
    os.replace(temporary, output)
    marker.write_text(expected + "\n", encoding="ascii", newline="\n")
    return "built"


def _copy_if_different(source: Path, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.is_file()
        and destination.stat().st_size == source.stat().st_size
        and _sha256(destination) == _sha256(source)
    ):
        return "cached"
    temporary = destination.with_name(destination.stem + ".tmp" + destination.suffix)
    temporary.unlink(missing_ok=True)
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)
    return "copied"


def _prepare_firtool(
    runtime_root: Path,
    settings: Mapping[str, Any],
    environment: Mapping[str, str],
) -> dict[str, str]:
    firtool = settings.get("firtool")
    if not isinstance(firtool, Mapping):
        raise ValueError("chiselRuntime requires firtool settings")
    override_name = firtool.get("overrideEnv")
    if not isinstance(override_name, str) or not override_name:
        raise ValueError("chiselRuntime firtool requires overrideEnv")
    configured = environment.get(override_name)
    if configured:
        directory = Path(configured).expanduser().resolve()
        if not directory.is_dir() or not any(
            (directory / name).is_file() for name in ("firtool.exe", "firtool")
        ):
            raise ValueError(
                f"{override_name} must name a directory containing firtool.exe or firtool"
            )
        return {
            "path": str(directory),
            "source": "environment",
            "version": str(firtool.get("version", "external")),
            "status": "preserved",
        }

    version = firtool.get("version")
    cache_env = firtool.get("cacheEnv")
    cache_relative = firtool.get("cacheRelative")
    if not all(isinstance(value, str) and value for value in (version, cache_env, cache_relative)):
        raise ValueError(
            "chiselRuntime firtool requires version, cacheEnv, and cacheRelative"
        )
    cache_root = environment.get(cache_env)
    if not cache_root:
        raise ValueError(f"{cache_env} is required to locate the Chisel firtool cache")
    source = Path(cache_root).expanduser() / cache_relative.format(version=version)
    if not source.is_file():
        raise RuntimeError(
            f"firtool {version} is not present in the Chisel resolver cache: {source}. "
            "Resolve the project dependencies once or set CHISEL_FIRTOOL_PATH."
        )
    destination = runtime_root / "firtool" / version / "firtool.exe"
    status = _copy_if_different(source, destination)
    return {
        "path": str(destination.parent),
        "source": str(source.resolve()),
        "version": version,
        "status": status,
    }


def _absolute_without_link_resolution(path: Path) -> Path:
    return Path(os.path.abspath(path))


def _requires_project_alias(path: Path) -> bool:
    value = str(path)
    # svsim appends suite, test, backend, and generated-source names to the
    # project root.  A moderately long ASCII root can therefore cross the
    # legacy Windows path boundary even though the root itself looks safe.
    return (
        len(value) >= 64
        or any(character.isspace() or ord(character) > 127 for character in value)
    )


def _prepare_project_execution_root(
    project_root: Path,
    runtime_root: Path,
    environment: Mapping[str, str],
) -> dict[str, str]:
    logical = _absolute_without_link_resolution(project_root)
    if not logical.is_dir():
        raise ValueError(f"Chisel project directory does not exist: {logical}")
    canonical = logical.resolve()
    if not _requires_project_alias(logical):
        return {
            "logicalRoot": str(canonical),
            "executionRoot": str(logical),
            "mode": "direct",
        }

    system_root = environment.get("SystemRoot", environment.get("SYSTEMROOT", "C:\\Windows"))
    subst = Path(system_root) / "System32" / "subst.exe"
    failures: list[str] = []
    for letter in reversed("PQRSTUVWXYZ"):
        drive = f"{letter}:"
        execution_root = Path(drive + "\\")
        if execution_root.exists():
            continue
        completed = subprocess.run(
            [str(subst), drive, str(canonical)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )
        if completed.returncode == 0 and execution_root.is_dir():
            return {
                "logicalRoot": str(canonical),
                "executionRoot": str(logical),
                "aliasRoot": str(execution_root),
                "mode": "subst_alias",
                "drive": drive,
                "substExecutable": str(subst),
            }
        failures.append(
            f"{drive} exit {completed.returncode}: "
            f"{(completed.stderr or completed.stdout).strip()[:160]}"
        )
    raise RuntimeError(
        "cannot allocate a temporary ASCII drive for the Chisel project: "
        + "; ".join(failures)
    )


def _release_project_execution_root(project: Mapping[str, Any]) -> None:
    if project.get("mode") != "subst_alias":
        return
    drive = project.get("drive")
    executable = project.get("substExecutable")
    if not isinstance(drive, str) or not isinstance(executable, str):
        raise RuntimeError("invalid temporary Chisel drive cleanup metadata")
    completed = subprocess.run(
        [executable, drive, "/D"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(
            f"cannot release temporary Chisel drive {drive}: "
            f"exit {completed.returncode}: {detail[:400]}"
        )


def prepare_chisel_runtime(
    repo_root: Path,
    contract: Mapping[str, Any],
    doctor_report: Mapping[str, Any],
    *,
    base_environment: Mapping[str, str] | None = None,
    project_root: Path | None = None,
) -> dict[str, Any]:
    runtime = doctor_report.get("runtimes", {}).get("chisel")
    if not isinstance(runtime, Mapping) or not runtime.get("ok"):
        raise ValueError("Chisel runtime companions did not pass doctor")
    settings = contract.get("chiselRuntime")
    if not isinstance(settings, Mapping):
        raise ValueError("toolchain contract requires chiselRuntime")
    source_environment = os.environ if base_environment is None else base_environment
    generated = _runtime_directory(repo_root, contract)
    adapter_directory = generated / "toolchain-bin"
    compiler = _tool_path(doctor_report, "cxx")
    real_make = _tool_path(doctor_report, "make")
    native_sources = repo_root.resolve() / "tools" / "native"

    which_status = _compile_adapter(
        compiler,
        native_sources / "which.cpp",
        adapter_directory / "which.exe",
    )
    make_status = _compile_adapter(
        compiler,
        native_sources / "make-wrapper.cpp",
        adapter_directory / "make.exe",
        extra_flags=("-municode",),
    )
    mingw_make_status = _copy_if_different(
        adapter_directory / "make.exe", adapter_directory / "mingw32-make.exe"
    )
    firtool = _prepare_firtool(generated, settings, source_environment)
    firtool_override = settings["firtool"]["overrideEnv"]
    project = (
        _prepare_project_execution_root(project_root, generated, source_environment)
        if project_root is not None
        else None
    )
    project_overrides: dict[str, str] = {}
    if isinstance(project, Mapping):
        project_overrides["CHISEL_PROJECT_ROOT"] = str(
            project.get("aliasRoot", project["executionRoot"])
        )
    if isinstance(project, Mapping) and project.get("mode") == "subst_alias":
        project_overrides.update({
            "PROCESSOR_SKILLS_PROJECT_ROOT": str(project["logicalRoot"]),
            "PROCESSOR_SKILLS_PROJECT_ALIAS": str(project["drive"]),
        })

    return {
        "schemaVersion": 1,
        "pathPrepend": [str(adapter_directory)],
        "environmentOverrides": {
            "PROCESSOR_SKILLS_REAL_MAKE": str(real_make),
            "PROCESSOR_SKILLS_MSYS2_ROOT": str(runtime["root"]),
            str(firtool_override): firtool["path"],
            **project_overrides,
        },
        "adapters": {
            "which": {
                "path": str(adapter_directory / "which.exe"),
                "status": which_status,
            },
            "make": {
                "path": str(adapter_directory / "make.exe"),
                "status": make_status,
            },
            "mingw32Make": {
                "path": str(adapter_directory / "mingw32-make.exe"),
                "status": mingw_make_status,
            },
        },
        "firtool": firtool,
        "project": project,
    }


def _deduplicate_path(entries: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        if not entry:
            continue
        key = str(Path(entry)).casefold()
        if key not in seen:
            seen.add(key)
            result.append(entry)
    return result


def build_chisel_environment(
    doctor_report: Mapping[str, Any],
    *,
    base_environment: Mapping[str, str] | None = None,
    support: Mapping[str, Any] | None = None,
) -> dict[str, str]:
    runtime = doctor_report.get("runtimes", {}).get("chisel")
    if not isinstance(runtime, Mapping) or not runtime.get("ok"):
        raise ValueError("Chisel runtime companions did not pass doctor")
    prepend = runtime.get("pathPrepend")
    overrides = runtime.get("environmentOverrides")
    unset = runtime.get("environmentUnset", [])
    if not isinstance(prepend, list) or not all(
        isinstance(item, str) for item in prepend
    ):
        raise ValueError("Chisel runtime has no valid PATH entries")
    if not isinstance(overrides, Mapping) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in overrides.items()
    ):
        raise ValueError("Chisel runtime has no valid environment overrides")
    if not isinstance(unset, list) or not all(isinstance(item, str) for item in unset):
        raise ValueError("Chisel runtime has no valid environment unset list")

    source = os.environ if base_environment is None else base_environment
    child = dict(source)
    existing = source.get("PATH", "").split(os.pathsep)
    support_prepend: list[str] = []
    support_overrides: Mapping[str, str] = {}
    if support is not None:
        raw_prepend = support.get("pathPrepend", [])
        raw_overrides = support.get("environmentOverrides", {})
        if not isinstance(raw_prepend, list) or not all(
            isinstance(item, str) for item in raw_prepend
        ):
            raise ValueError("Chisel support has invalid PATH entries")
        if not isinstance(raw_overrides, Mapping) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in raw_overrides.items()
        ):
            raise ValueError("Chisel support has invalid environment overrides")
        support_prepend = raw_prepend
        support_overrides = raw_overrides
    child["PATH"] = os.pathsep.join(
        _deduplicate_path([*support_prepend, *prepend, *existing])
    )
    child.update(overrides)
    child.update(support_overrides)
    for name in unset:
        child.pop(name, None)
    return child


def resolve_chisel_command(
    doctor_report: Mapping[str, Any], command: Sequence[str]
) -> list[str]:
    if not command:
        raise ValueError("Chisel command is required after --")
    resolved = list(command)
    aliases = {
        "sbt": "sbt",
        "sbt.bat": "sbt",
        "java": "java",
        "java.exe": "java",
        "verilator": "verilator",
        "verilator.exe": "verilator",
        "verilator_bin.exe": "verilator",
        "g++": "cxx",
        "g++.exe": "cxx",
        "make": "make",
        "make.exe": "make",
        "mingw32-make.exe": "make",
    }
    tool_id = aliases.get(Path(resolved[0]).name.casefold())
    if tool_id is None:
        return resolved
    tool = next(
        (
            item
            for item in doctor_report.get("tools", [])
            if item.get("id") == tool_id and item.get("status") == "ok"
        ),
        None,
    )
    if not isinstance(tool, Mapping) or not isinstance(tool.get("path"), str):
        raise ValueError(f"doctor did not resolve required tool: {tool_id}")
    resolved[0] = tool["path"]
    return resolved


def windows_launch_arguments(
    command: Sequence[str], _environment: Mapping[str, str]
) -> list[str]:
    if not command:
        raise ValueError("cannot launch an empty command")
    return list(command)


def _default_command_runner(
    command: Sequence[str],
    cwd: Path,
    environment: Mapping[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        cwd=cwd,
        env=dict(environment),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )


def run_chisel_command(
    doctor_report: Mapping[str, Any],
    project_root: Path,
    command: Sequence[str],
    *,
    base_environment: Mapping[str, str] | None = None,
    support: Mapping[str, Any] | None = None,
    runner: CommandRunner = _default_command_runner,
) -> dict[str, Any]:
    logical_project = project_root.resolve()
    project = _absolute_without_link_resolution(project_root)
    if support is not None:
        support_project = support.get("project")
        if isinstance(support_project, Mapping) and isinstance(
            support_project.get("executionRoot"), str
        ):
            project = Path(support_project["executionRoot"])
    if not project.is_dir():
        raise ValueError(f"Chisel project directory does not exist: {logical_project}")
    support_project = support.get("project") if support is not None else None
    try:
        child_environment = build_chisel_environment(
            doctor_report, base_environment=base_environment, support=support
        )
        resolved = resolve_chisel_command(doctor_report, command)
        launched = windows_launch_arguments(resolved, child_environment)
        completed = runner(launched, project, child_environment)
    finally:
        if isinstance(support_project, Mapping):
            _release_project_execution_root(support_project)
    runtime = doctor_report["runtimes"]["chisel"]
    return {
        "schemaVersion": 1,
        "ok": completed.returncode == 0,
        "projectRoot": str(logical_project),
        "executionRoot": str(project),
        "requestedCommand": list(command),
        "resolvedCommand": resolved,
        "launchedCommand": launched,
        "childExitCode": completed.returncode,
        "environment": {
            "pathPrepend": [
                *(support.get("pathPrepend", []) if support is not None else []),
                *runtime["pathPrepend"],
            ],
            "overrides": {
                **runtime["environmentOverrides"],
                **(
                    support.get("environmentOverrides", {})
                    if support is not None
                    else {}
                ),
            },
            "unset": runtime["environmentUnset"],
        },
        "support": support,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
