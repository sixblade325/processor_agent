"""Command-line interface for the Windows execution support kit."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

from .chisel import prepare_chisel_runtime, run_chisel_command
from .doctor import EXIT_CONTRACT, EXIT_ENVIRONMENT, EXIT_EXTERNAL, diagnose, load_contract, render_human
from .installation import install_local_plugin, uninstall_local_plugin
from .packaging import MARKETPLACE_NAME, build_package
from .textio import (
    UTF8_SMOKE_TEXT,
    Utf8DecodeError,
    check_utf8_smoke,
    inspect_utf8_text,
)
from .validation import validate_repository


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def _print_error(args: argparse.Namespace, kind: str, message: str) -> None:
    if getattr(args, "json", False):
        print(
            _json(
                {
                    "schemaVersion": 1,
                    "ok": False,
                    "error": {"kind": kind, "message": message},
                }
            )
        )
    else:
        labels = {
            "configuration": "配置错误",
            "encoding_error": "编码错误",
            "external_command": "外部命令失败",
        }
        print(f"{labels[kind]}: {message}", file=sys.stderr)


def _runtime_output(repo_root: Path) -> Path:
    contract = load_contract(repo_root / "environment" / "toolchains.json")
    runtime = contract.get("runtimeDirectory")
    if not isinstance(runtime, str) or not runtime:
        raise ValueError("toolchain contract has no runtimeDirectory")
    return repo_root / runtime / "dist"


def _diagnose_product(
    repo_root: Path,
    contract: dict[str, Any],
    profile: str,
) -> dict[str, Any]:
    report = diagnose(contract, profile)
    encoding = check_utf8_smoke(
        repo_root / "environment" / "utf8-smoke.txt",
        UTF8_SMOKE_TEXT,
    )
    report["utf8Text"] = encoding
    if not encoding["ok"]:
        report["ok"] = False
        report["requiredFailures"].append("utf8_text")
    return report


def run_tool_tests(repo_root: Path) -> dict[str, Any]:
    tests_root = repo_root / "tests"
    if not tests_root.is_dir():
        return {
            "ok": False,
            "command": [],
            "exitCode": 3,
            "stdout": "",
            "stderr": f"tests directory is missing: {tests_root}",
        }
    command = [
        sys.executable,
        "-X",
        "utf8",
        "-m",
        "unittest",
        "discover",
        "-s",
        str(tests_root),
        "-p",
        "test_*.py",
        "-v",
    ]
    completed = subprocess.run(
        command,
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    return {
        "ok": completed.returncode == 0,
        "command": command,
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def _build(
    repo_root: Path,
    output: Path,
    *,
    allow_dirty: bool,
    skip_tests: bool,
) -> tuple[dict[str, Any], int]:
    tests = None if skip_tests else run_tool_tests(repo_root)
    if tests is not None and not tests["ok"]:
        return {"schemaVersion": 1, "ok": False, "tests": tests}, EXIT_CONTRACT
    package = build_package(repo_root, output, allow_dirty=allow_dirty)
    result = {"schemaVersion": 1, "ok": True, "tests": tests, "package": package}
    return result, 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="processor-skills",
        description="Windows-native execution support for Processor Development Skills.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=repository_root(),
        help="Processor Development Skills source root.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="Probe the declared Windows toolchain.")
    doctor.add_argument("--profile", default="package", choices=("build", "package", "chisel", "vivado", "all"))
    doctor.add_argument("--json", action="store_true")

    validate = subparsers.add_parser("validate-skills", help="Validate plugin and Skill structure.")
    validate.add_argument("--json", action="store_true")

    check_docs = subparsers.add_parser("check-docs", help="Run the bundled processor document checker.")
    check_docs.add_argument("project", nargs="?", type=Path, default=Path.cwd())
    check_docs.add_argument("--root", action="append", default=[])
    check_docs.add_argument("--json", action="store_true")
    check_docs.add_argument("--hard-limit-policy", choices=("error", "off", "warn"), default="warn")
    check_docs.add_argument("--budget-config", type=Path)

    read_text = subparsers.add_parser(
        "read-text",
        help="Read a text file as strict UTF-8 with optional BOM.",
    )
    read_text.add_argument("path", type=Path)
    read_text.add_argument("--json", action="store_true")

    chisel_run = subparsers.add_parser(
        "chisel-run",
        help="Run a command inside the resolved process-scoped Chisel toolchain.",
    )
    chisel_run.add_argument("--json", action="store_true")
    chisel_run.add_argument("project", type=Path)
    chisel_run.add_argument("tool_command", nargs=argparse.REMAINDER)

    tests = subparsers.add_parser("test-tools", help="Run tool-level release tests.")
    tests.add_argument("--json", action="store_true")

    build = subparsers.add_parser("build", help="Build a deterministic plugin archive and local marketplace.")
    build.add_argument("--output", type=Path)
    build.add_argument("--allow-dirty", action="store_true")
    build.add_argument("--skip-tests", action="store_true")
    build.add_argument("--json", action="store_true")

    initialize = subparsers.add_parser("initialize", help="Check, build, and install the local Codex plugin.")
    initialize.add_argument("--output", type=Path)
    initialize.add_argument("--allow-dirty", action="store_true")
    initialize.add_argument("--skip-tests", action="store_true")
    initialize.add_argument("--build-only", action="store_true")
    initialize.add_argument("--json", action="store_true")

    uninstall = subparsers.add_parser("uninstall", help="Remove the local plugin and marketplace from Codex.")
    uninstall.add_argument("--json", action="store_true")
    return parser


def _print_validation(report: dict[str, Any]) -> None:
    if report["ok"]:
        print(f"插件与 Skill 结构检查通过，共 {len(report['skills'])} 个 Skill。")
    else:
        print("插件与 Skill 结构检查失败。")
        for error in report["errors"]:
            print(f"  {error}")


def _print_test_report(report: dict[str, Any]) -> None:
    if report["stdout"]:
        print(report["stdout"], end="" if report["stdout"].endswith("\n") else "\n")
    if report["stderr"]:
        stream = sys.stderr if not report["ok"] else sys.stdout
        print(report["stderr"], end="" if report["stderr"].endswith("\n") else "\n", file=stream)


def _run_check_docs(args: argparse.Namespace, repo_root: Path) -> int:
    checker = repo_root / "skills" / "organize-processor-docs" / "scripts" / "check_docs.py"
    command = [
        sys.executable,
        "-X",
        "utf8",
        str(checker),
        str(args.project.resolve()),
        "--hard-limit-policy",
        args.hard_limit_policy,
    ]
    for root in args.root:
        command.extend(["--root", root])
    if args.budget_config:
        command.extend(["--budget-config", str(args.budget_config.resolve())])
    if args.json:
        command.append("--json")
    completed = subprocess.run(command, check=False, shell=False)
    return completed.returncode


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    repo_root = args.repo_root.resolve()
    try:
        if args.command == "doctor":
            contract = load_contract(repo_root / "environment" / "toolchains.json")
            report = _diagnose_product(repo_root, contract, args.profile)
            print(_json(report) if args.json else render_human(report))
            return 0 if report["ok"] else EXIT_ENVIRONMENT

        if args.command == "validate-skills":
            report = validate_repository(repo_root)
            if args.json:
                print(_json(report))
            else:
                _print_validation(report)
            return 0 if report["ok"] else EXIT_CONTRACT

        if args.command == "check-docs":
            return _run_check_docs(args, repo_root)

        if args.command == "read-text":
            result = inspect_utf8_text(args.path)
            if args.json:
                print(_json(result))
            else:
                sys.stdout.write(result["text"])
            return 0

        if args.command == "chisel-run":
            contract = load_contract(repo_root / "environment" / "toolchains.json")
            doctor_report = _diagnose_product(repo_root, contract, "chisel")
            if not doctor_report["ok"]:
                print(_json(doctor_report) if args.json else render_human(doctor_report))
                return EXIT_ENVIRONMENT
            command = list(args.tool_command)
            if command and command[0] == "--":
                command = command[1:]
            support = prepare_chisel_runtime(
                repo_root,
                contract,
                doctor_report,
                project_root=args.project,
            )
            result = run_chisel_command(
                doctor_report,
                args.project,
                command,
                support=support,
            )
            if args.json:
                print(_json(result))
            else:
                if result["stdout"]:
                    print(
                        result["stdout"],
                        end="" if result["stdout"].endswith("\n") else "\n",
                    )
                if result["stderr"]:
                    print(
                        result["stderr"],
                        end="" if result["stderr"].endswith("\n") else "\n",
                        file=sys.stderr,
                    )
                state = "通过" if result["ok"] else "失败"
                print(
                    f"Chisel 命令: {state}; childExitCode={result['childExitCode']}; "
                    f"project={result['projectRoot']}"
                )
            return 0 if result["ok"] else EXIT_EXTERNAL

        if args.command == "test-tools":
            report = run_tool_tests(repo_root)
            print(_json(report)) if args.json else _print_test_report(report)
            return 0 if report["ok"] else EXIT_CONTRACT

        if args.command in {"build", "initialize"}:
            output = args.output.resolve() if args.output else _runtime_output(repo_root)
            contract = load_contract(repo_root / "environment" / "toolchains.json")
            profile = "package" if args.command == "initialize" else "build"
            doctor_report = _diagnose_product(repo_root, contract, profile)
            if not doctor_report["ok"]:
                print(_json(doctor_report) if args.json else render_human(doctor_report))
                return EXIT_ENVIRONMENT

            build_report, exit_code = _build(
                repo_root,
                output,
                allow_dirty=args.allow_dirty,
                skip_tests=args.skip_tests,
            )
            if exit_code != 0:
                print(_json(build_report)) if args.json else _print_test_report(build_report["tests"])
                return exit_code

            install_report = None
            if args.command == "initialize" and not args.build_only:
                package = build_report["package"]
                codex_tool = next(
                    item for item in doctor_report["tools"] if item["id"] == "codex"
                )
                install_report = install_local_plugin(
                    Path(package["marketplace"]),
                    package["marketplaceName"],
                    package["pluginName"],
                    codex_executable=codex_tool["path"],
                )
            result = {
                "schemaVersion": 1,
                "ok": True,
                "doctor": doctor_report,
                "build": build_report,
                "install": install_report,
            }
            if args.json:
                print(_json(result))
            else:
                if build_report["tests"] is not None:
                    _print_test_report(build_report["tests"])
                package = build_report["package"]
                print(f"构建完成: {package['archive']}")
                print(f"SHA256: {package['archiveSha256']}")
                if install_report is not None:
                    print(
                        f"安装完成: {package['pluginName']}@{package['marketplaceName']}。"
                        "请使用新 Codex 会话加载插件。"
                    )
            return 0

        if args.command == "uninstall":
            manifest = json.loads(
                (repo_root / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8")
            )
            codex_executable = os.environ.get("PROCESSOR_SKILLS_CODEX") or shutil.which("codex")
            if not codex_executable:
                raise RuntimeError("Codex CLI was not found")
            result = uninstall_local_plugin(
                MARKETPLACE_NAME,
                manifest["name"],
                codex_executable=codex_executable,
            )
            print(_json(result) if args.json else f"卸载完成: {manifest['name']}")
            return 0
    except Utf8DecodeError as error:
        _print_error(args, "encoding_error", str(error))
        return EXIT_CONTRACT
    except ValueError as error:
        _print_error(args, "configuration", str(error))
        return EXIT_CONTRACT
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        _print_error(args, "external_command", str(error))
        return EXIT_EXTERNAL
    return EXIT_CONTRACT
