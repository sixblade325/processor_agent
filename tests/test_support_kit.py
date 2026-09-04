from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT / "tools"
if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

from processor_skills.chisel import (
    _requires_project_alias,
    build_chisel_environment,
    run_chisel_command,
    windows_launch_arguments,
)
from processor_skills.argument_transport import (
    FIXED_COMMAND_ENV,
    RAW_ARGUMENTS_ENV,
    TRANSPORT_ENV,
    TRANSPORT_VERSION,
    arguments_from_environment,
    split_windows_command_line,
)
from processor_skills.doctor import diagnose, inspect_chisel_runtime, load_contract, probe_tool
from processor_skills.installation import install_local_plugin, uninstall_local_plugin
from processor_skills.packaging import MARKETPLACE_NAME, build_package
from processor_skills.textio import (
    UTF8_SMOKE_TEXT,
    Utf8DecodeError,
    check_utf8_smoke,
    inspect_utf8_text,
    read_utf8_text,
)
from processor_skills.validation import validate_repository


class ContractAndDoctorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = load_contract(REPO_ROOT / "environment" / "toolchains.json")

    def test_contract_is_windows_only(self) -> None:
        self.assertEqual(self.contract["supportedPlatforms"], ["windows"])
        self.assertEqual(self.contract["architecture"], "x86_64")
        self.assertEqual(self.contract["executionBoundary"], "windows-native")

    def test_required_missing_tool_fails_profile(self) -> None:
        def no_tools(_: str) -> str | None:
            return None

        def python_only(args: list[str], _: int) -> subprocess.CompletedProcess[str]:
            if Path(args[0]).resolve() == Path(sys.executable).resolve():
                return subprocess.CompletedProcess(args, 0, "Python 3.12.0\n", "")
            raise AssertionError(args)

        report = diagnose(
            self.contract,
            "build",
            environment={},
            which=no_tools,
            run=python_only,
        )
        self.assertFalse(report["ok"])
        self.assertIn("git", report["requiredFailures"])
        git = next(item for item in report["tools"] if item["id"] == "git")
        self.assertEqual(git["status"], "missing")
        self.assertTrue(git["required"])

    def test_profile_only_probes_its_declared_tools(self) -> None:
        seen: list[str] = []

        def fake_which(command: str) -> str:
            return f"C:\\tools\\{command}"

        def fake_run(args: list[str], _: int) -> subprocess.CompletedProcess[str]:
            seen.append(Path(args[0]).name)
            if Path(args[0]).resolve() == Path(sys.executable).resolve():
                output = "Python 3.12.0\n"
            elif Path(args[0]).name == "git":
                output = "git version 2.54.0\n"
            else:
                raise AssertionError(f"unexpected build-profile probe: {args}")
            return subprocess.CompletedProcess(args, 0, output, "")

        report = diagnose(
            self.contract,
            "build",
            environment={},
            which=fake_which,
            run=fake_run,
        )
        self.assertTrue(report["ok"])
        self.assertEqual([item["id"] for item in report["tools"]], ["python", "git"])
        self.assertEqual(len(seen), 2)

    def test_msys2_root_resolves_native_verilator_binary(self) -> None:
        spec = next(tool for tool in self.contract["tools"] if tool["id"] == "verilator")
        environment = {"PROCESSOR_SKILLS_MSYS2_ROOT": "C:\\toolchains\\msys64"}

        def no_path(_: str) -> str | None:
            return None

        def fake_run(args: list[str], _: int) -> subprocess.CompletedProcess[str]:
            self.assertTrue(args[0].endswith("ucrt64\\bin\\verilator_bin.exe"))
            return subprocess.CompletedProcess(args, 0, "Verilator 5.040\n", "")

        result = probe_tool(
            spec,
            True,
            environment=environment,
            which=no_path,
            run=fake_run,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["version"], "5.040")

    def test_old_version_is_classified(self) -> None:
        spec = {
            "id": "example",
            "label": "Example",
            "commands": [["example", "--version"]],
            "versionRegex": r"Example (\d+\.\d+)",
            "minimumVersion": "3.0",
        }

        def fake_which(_: str) -> str:
            return "C:\\tools\\example.exe"

        def fake_run(args: list[str], _: int) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(args, 0, "Example 2.9\n", "")

        result = probe_tool(spec, True, which=fake_which, run=fake_run)
        self.assertEqual(result["status"], "version_too_old")


class ChiselRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = load_contract(REPO_ROOT / "environment" / "toolchains.json")

    def _create_runtime(self, base: Path) -> tuple[Path, list[dict[str, object]]]:
        root = base / "MSYS Root"
        verilator = root / "ucrt64" / "bin" / "verilator_bin.exe"
        verilator.parent.mkdir(parents=True)
        verilator.touch()
        for relative in ("usr/bin/which.exe", "usr/bin/sh.exe"):
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        (root / "ucrt64" / "share" / "verilator").mkdir(parents=True)
        tools: list[dict[str, object]] = [
            {"id": "verilator", "status": "ok", "path": str(verilator)},
            {
                "id": "sbt",
                "status": "ok",
                "path": str(base / "Tool Chain" / "sbt.bat"),
            },
        ]
        tools.extend(
            {
                "id": tool_id,
                "status": "ok",
                "path": str(root / "ucrt64" / "bin" / executable),
            }
            for tool_id, executable in (
                ("java", "java.exe"),
                ("cxx", "g++.exe"),
                ("make", "mingw32-make.exe"),
            )
        )
        return root, tools

    def test_runtime_companions_are_resolved_from_verilator(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root, tools = self._create_runtime(Path(temp_name))
            result = inspect_chisel_runtime(self.contract, tools, environment={})
            self.assertTrue(result["ok"])
            self.assertEqual(Path(result["root"]), root.resolve())
            self.assertEqual(
                {item["id"] for item in result["tools"]},
                {"chisel_which", "chisel_shell", "verilator_root"},
            )

    def test_project_alias_covers_long_ascii_roots(self) -> None:
        self.assertFalse(_requires_project_alias(Path("E:/cpu")))
        self.assertTrue(_requires_project_alias(Path("E:/processor project")))
        self.assertTrue(_requires_project_alias(Path("E:/处理器")))
        self.assertTrue(
            _requires_project_alias(Path("E:/" + ("long-ascii-root/" * 5)))
        )

    def test_missing_which_has_a_precise_diagnostic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root, tools = self._create_runtime(Path(temp_name))
            (root / "usr" / "bin" / "which.exe").unlink()
            result = inspect_chisel_runtime(self.contract, tools, environment={})
            self.assertFalse(result["ok"])
            which = next(item for item in result["tools"] if item["id"] == "chisel_which")
            self.assertEqual(which["status"], "missing")
            self.assertIn("which.exe", which["path"])
            self.assertIn(str(root), which["detail"])

    def test_child_environment_does_not_mutate_parent_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            _, tools = self._create_runtime(Path(temp_name))
            runtime = inspect_chisel_runtime(self.contract, tools, environment={})
            report = {"runtimes": {"chisel": runtime}}
            parent = {
                "PATH": "C:\\parent path",
                "COMSPEC": "C:\\Windows\\cmd.exe",
                "SHELL": "C:\\inherited\\sh.exe",
            }
            before = dict(parent)
            child = build_chisel_environment(report, base_environment=parent)
            self.assertEqual(parent, before)
            self.assertNotEqual(child["PATH"], parent["PATH"])
            self.assertTrue(child["PATH"].endswith(parent["PATH"]))
            self.assertNotIn("SHELL", child)
            self.assertTrue(child["VERILATOR_ROOT"].endswith("ucrt64\\share\\verilator"))

            support = {
                "pathPrepend": ["C:\\generated adapters"],
                "environmentOverrides": {
                    "CHISEL_FIRTOOL_PATH": "C:\\firtool alias"
                },
            }
            supported = build_chisel_environment(
                report,
                base_environment=parent,
                support=support,
            )
            self.assertTrue(supported["PATH"].startswith("C:\\generated adapters"))
            self.assertEqual(
                supported["CHISEL_FIRTOOL_PATH"], "C:\\firtool alias"
            )
            self.assertEqual(parent, before)

    def test_command_uses_explicit_project_and_quotes_batch_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            base = Path(temp_name)
            _, tools = self._create_runtime(base)
            runtime = inspect_chisel_runtime(self.contract, tools, environment={})
            report = {"tools": tools, "runtimes": {"chisel": runtime}}
            project = base / "处理器 项目"
            project.mkdir()
            observed: dict[str, object] = {}

            def fake_runner(
                command: list[str], cwd: Path, environment: dict[str, str]
            ) -> subprocess.CompletedProcess[str]:
                observed["command"] = list(command)
                observed["cwd"] = cwd
                observed["environment"] = dict(environment)
                return subprocess.CompletedProcess(command, 0, "smoke pass\n", "")

            result = run_chisel_command(
                report,
                project,
                ["sbt", "-batch", "test"],
                base_environment={
                    "PATH": "C:\\parent",
                    "COMSPEC": "C:\\Windows\\System32\\cmd.exe",
                },
                runner=fake_runner,
            )
            self.assertTrue(result["ok"])
            self.assertEqual(observed["cwd"], project.resolve())
            launched = observed["command"]
            self.assertEqual(
                launched,
                [str(base / "Tool Chain" / "sbt.bat"), "-batch", "test"],
            )

    def test_batch_command_preserves_argument_boundaries_and_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            base = Path(temp_name)
            _, tools = self._create_runtime(base)
            runtime = inspect_chisel_runtime(self.contract, tools, environment={})
            report = {"tools": tools, "runtimes": {"chisel": runtime}}
            project = base / "处理器 项目"
            project.mkdir()
            probe = base / "argv_probe.py"
            probe.write_text(
                "import json, sys\nprint(json.dumps(sys.argv[1:], ensure_ascii=False))\n",
                encoding="utf-8",
            )
            batch = base / "Tool Chain" / "argv probe.cmd"
            batch.parent.mkdir(parents=True, exist_ok=True)
            batch.write_text(
                "@echo off\r\n"
                + subprocess.list2cmdline([sys.executable, "-X", "utf8", str(probe)])
                + " %*\r\n"
                + "exit /b %ERRORLEVEL%\r\n",
                encoding="utf-8",
            )
            arguments = [
                "multi word",
                "",
                'nested "quote"',
                "处理器参数",
                "C:\\path with space\\",
            ]

            result = run_chisel_command(
                report,
                project,
                [str(batch), *arguments],
                base_environment={
                    "PATH": "C:\\parent",
                    "COMSPEC": "C:\\Windows\\System32\\cmd.exe",
                },
            )

            self.assertTrue(result["ok"], result["stderr"])
            self.assertEqual(json.loads(result["stdout"]), arguments)
            self.assertEqual(result["requestedCommand"], [str(batch), *arguments])
            self.assertEqual(result["resolvedCommand"], [str(batch), *arguments])
            self.assertEqual(result["launchedCommand"], [str(batch), *arguments])
            self.assertEqual(result["childExitCode"], 0)

            failing = base / "Tool Chain" / "fail.cmd"
            failing.write_text("@exit /b 23\r\n", encoding="utf-8")
            failed = run_chisel_command(
                report,
                project,
                [str(failing)],
                base_environment={
                    "PATH": "C:\\parent",
                    "COMSPEC": "C:\\Windows\\System32\\cmd.exe",
                },
            )
            self.assertFalse(failed["ok"])
            self.assertEqual(failed["childExitCode"], 23)

    def test_windows_launch_arguments_never_rebuilds_a_command_string(self) -> None:
        command = ["C:\\Tool Chain\\runner.cmd", "multi word", ""]
        self.assertEqual(
            windows_launch_arguments(command, {"COMSPEC": "C:\\Windows\\cmd.exe"}),
            command,
        )


class Utf8TextTest(unittest.TestCase):
    def test_reader_accepts_utf8_without_bom_and_with_bom(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            expected = "处理器文档\n第二行\n"
            no_bom = root / "无 BOM.md"
            with_bom = root / "有 BOM.md"
            no_bom.write_bytes(expected.encode("utf-8"))
            with_bom.write_bytes(b"\xef\xbb\xbf" + expected.encode("utf-8"))

            self.assertEqual(read_utf8_text(no_bom), expected)
            self.assertEqual(read_utf8_text(with_bom), expected)
            self.assertFalse(inspect_utf8_text(no_bom)["bom"])
            self.assertTrue(inspect_utf8_text(with_bom)["bom"])

    def test_reader_reports_invalid_encoding(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "legacy.md"
            path.write_bytes("处理器".encode("utf-16"))
            with self.assertRaises(Utf8DecodeError):
                read_utf8_text(path)

    def test_smoke_check_requires_exact_utf8_content(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "utf8-smoke.txt"
            path.write_text(UTF8_SMOKE_TEXT, encoding="utf-8")
            self.assertTrue(check_utf8_smoke(path, UTF8_SMOKE_TEXT)["ok"])
            self.assertFalse(check_utf8_smoke(path, "different\n")["ok"])


class ArgumentTransportTest(unittest.TestCase):
    def test_windows_command_line_round_trip_preserves_edge_arguments(self) -> None:
        arguments = [
            "multi word",
            "",
            'nested "quote"',
            "处理器参数",
            "C:\\path with space\\",
        ]
        raw = subprocess.list2cmdline(arguments)
        self.assertEqual(split_windows_command_line(raw), arguments)

    def test_environment_transport_adds_fixed_command_and_is_not_inherited(self) -> None:
        arguments = ["multi word", "", 'nested "quote"']
        transport = {
            TRANSPORT_ENV: TRANSPORT_VERSION,
            RAW_ARGUMENTS_ENV: subprocess.list2cmdline(arguments),
            FIXED_COMMAND_ENV: "chisel-run",
        }
        with mock.patch.dict(os.environ, transport, clear=False):
            self.assertEqual(
                arguments_from_environment(["ignored"]),
                ["chisel-run", *arguments],
            )
            for name in transport:
                self.assertNotIn(name, os.environ)


class ValidationAndPackagingTest(unittest.TestCase):
    def test_repository_structure_is_valid(self) -> None:
        report = validate_repository(REPO_ROOT)
        self.assertTrue(report["ok"], report["errors"])
        self.assertEqual(
            set(report["skills"]),
            {
                "bootstrap-processor-project",
                "organize-processor-docs",
                "design-chisel-processor",
                "implement-chisel-processor",
                "trace-vivado-timing-to-rtl",
                "optimize-chisel-fpga-timing",
            },
        )

    def test_package_is_reproducible_and_uses_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as first_name, tempfile.TemporaryDirectory() as second_name:
            first = build_package(REPO_ROOT, Path(first_name), allow_dirty=True)
            second = build_package(REPO_ROOT, Path(second_name), allow_dirty=True)
            self.assertEqual(first["archiveSha256"], second["archiveSha256"])
            self.assertEqual(first["payloadSha256"], second["payloadSha256"])

            with zipfile.ZipFile(first["archive"]) as archive:
                names = set(archive.namelist())
                self.assertIn(".codex-plugin/plugin.json", names)
                self.assertIn("PACKAGE_MANIFEST.json", names)
                self.assertIn("scripts/initialize.cmd", names)
                self.assertFalse(any(name.startswith("PRODUCT_PLAN/") for name in names))
                self.assertFalse(any(name.startswith("Logs/") for name in names))
                self.assertFalse(any(name.startswith("tests/") for name in names))
                self.assertFalse(any(name.endswith(".zip") for name in names))

                package_manifest = json.loads(archive.read("PACKAGE_MANIFEST.json"))
                self.assertEqual(package_manifest["payloadSha256"], first["payloadSha256"])
                self.assertIsInstance(package_manifest["sourceDirty"], bool)

    def test_generated_marketplace_has_canonical_local_shape(self) -> None:
        with tempfile.TemporaryDirectory() as output_name:
            result = build_package(REPO_ROOT, Path(output_name), allow_dirty=True)
            marketplace = json.loads(
                (
                    Path(result["marketplace"])
                    / ".agents"
                    / "plugins"
                    / "marketplace.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(marketplace["name"], MARKETPLACE_NAME)
            entry = marketplace["plugins"][0]
            self.assertEqual(entry["source"]["source"], "local")
            self.assertEqual(
                entry["source"]["path"],
                "./plugins/processor-development-skills",
            )
            self.assertEqual(entry["policy"]["installation"], "AVAILABLE")
            self.assertEqual(entry["policy"]["authentication"], "ON_INSTALL")


class InstallationTest(unittest.TestCase):
    def test_install_adds_marketplace_then_plugin(self) -> None:
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            marketplace_manifest = root / ".agents" / "plugins" / "marketplace.json"
            marketplace_manifest.parent.mkdir(parents=True)
            marketplace_manifest.write_text(
                json.dumps({"name": MARKETPLACE_NAME}), encoding="utf-8"
            )
            commands: list[list[str]] = []

            def fake_runner(args: list[str]) -> subprocess.CompletedProcess[str]:
                commands.append(list(args))
                if args[2:5] == ["marketplace", "list", "--json"]:
                    payload = {"marketplaces": []}
                else:
                    payload = {"ok": True}
                return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

            result = install_local_plugin(
                root,
                MARKETPLACE_NAME,
                "processor-development-skills",
                runner=fake_runner,
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["marketplaceAction"], "added")
            self.assertEqual(commands[0], ["codex", "plugin", "marketplace", "list", "--json"])
            self.assertEqual(commands[1][2:4], ["marketplace", "add"])
            self.assertEqual(
                commands[2],
                [
                    "codex",
                    "plugin",
                    "add",
                    "processor-development-skills@processor-development-skills-local",
                    "--json",
                ],
            )

    def test_conflicting_marketplace_stops_install(self) -> None:
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            marketplace_manifest = root / ".agents" / "plugins" / "marketplace.json"
            marketplace_manifest.parent.mkdir(parents=True)
            marketplace_manifest.write_text(
                json.dumps({"name": MARKETPLACE_NAME}), encoding="utf-8"
            )

            def fake_runner(args: list[str]) -> subprocess.CompletedProcess[str]:
                payload = {
                    "marketplaces": [
                        {"name": MARKETPLACE_NAME, "path": "C:\\other\\marketplace"}
                    ]
                }
                return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

            with self.assertRaises(RuntimeError):
                install_local_plugin(
                    root,
                    MARKETPLACE_NAME,
                    "processor-development-skills",
                    runner=fake_runner,
                )

    def test_uninstall_matches_the_plugin_marketplace(self) -> None:
        commands: list[list[str]] = []

        def fake_runner(args: list[str]) -> subprocess.CompletedProcess[str]:
            commands.append(list(args))
            if args[1:4] == ["plugin", "list", "--json"]:
                payload = {
                    "installed": [
                        {
                            "name": "processor-development-skills",
                            "marketplaceName": "another-marketplace",
                        }
                    ]
                }
            else:
                payload = {"marketplaces": []}
            return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

        result = uninstall_local_plugin(
            MARKETPLACE_NAME,
            "processor-development-skills",
            runner=fake_runner,
        )
        self.assertEqual(result["pluginAction"], "absent")
        self.assertEqual(result["marketplaceAction"], "absent")
        self.assertEqual(len(commands), 2)


class EntrypointTest(unittest.TestCase):
    def test_cmd_wrappers_route_to_one_cli(self) -> None:
        run = (REPO_ROOT / "scripts" / "run.cmd").read_text(encoding="utf-8")
        self.assertIn("run.ps1", run)
        self.assertIn("PROCESSOR_SKILLS_RAW_ARGUMENTS=%*", run)
        self.assertNotIn('run.ps1" %*', run)
        powershell = (REPO_ROOT / "scripts" / "run.ps1").read_text(encoding="utf-8")
        self.assertIn('[version]"3.10"', powershell)
        for name, command in (
            ("doctor.cmd", "doctor"),
            ("build.cmd", "build"),
            ("initialize.cmd", "initialize"),
            ("uninstall.cmd", "uninstall"),
            ("chisel-run.cmd", "chisel-run"),
            ("read-text.cmd", "read-text"),
        ):
            text = (REPO_ROOT / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("run.cmd", text)
            self.assertIn(command, text)
            self.assertIn("PROCESSOR_SKILLS_RAW_ARGUMENTS=%*", text)
            self.assertNotIn(f'run.cmd" {command} %*', text)

    def test_read_text_cmd_decodes_utf8_and_reports_encoding_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name) / "处理器 项目"
            root.mkdir()
            expected = "处理器文档\n第二行\n"
            for name, payload in (
                ("无 BOM.md", expected.encode("utf-8")),
                ("有 BOM.md", b"\xef\xbb\xbf" + expected.encode("utf-8")),
            ):
                path = root / name
                path.write_bytes(payload)
                completed = subprocess.run(
                    [str(REPO_ROOT / "scripts" / "read-text.cmd"), str(path)],
                    cwd=REPO_ROOT.parent,
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="strict",
                    shell=False,
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    completed.stderr + completed.stdout,
                )
                self.assertEqual(completed.stdout, expected)

            invalid = root / "UTF-16LE.md"
            invalid.write_bytes("处理器".encode("utf-16"))
            completed = subprocess.run(
                [
                    str(REPO_ROOT / "scripts" / "run.cmd"),
                    "read-text",
                    str(invalid),
                    "--json",
                ],
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="strict",
                shell=False,
            )
            self.assertEqual(completed.returncode, 3)
            report = json.loads(completed.stdout)
            self.assertFalse(report["ok"])
            self.assertEqual(report["error"]["kind"], "encoding_error")

    def test_agent_baselines_require_explicit_powershell_utf8_decoding(self) -> None:
        required = "Get-Content -Raw -Encoding utf8 -LiteralPath"
        repository_rules = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        project_rules = (
            REPO_ROOT
            / "skills"
            / "bootstrap-processor-project"
            / "assets"
            / "AGENTS.md"
        ).read_text(encoding="utf-8")
        bootstrap = (
            REPO_ROOT / "skills" / "bootstrap-processor-project" / "SKILL.md"
        ).read_text(encoding="utf-8")
        self.assertIn(required, repository_rules)
        self.assertIn(required, project_rules)
        self.assertIn(required, bootstrap)

    def test_utf8_smoke_fixture_is_exact(self) -> None:
        smoke = REPO_ROOT / "environment" / "utf8-smoke.txt"
        self.assertEqual(
            smoke.read_text(encoding="utf-8-sig"),
            "Processor Development Skills UTF-8 smoke: 处理器文档\n",
        )

    def test_check_docs_supports_unicode_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            project = Path(temp_name) / "处理器 项目"
            for root in ("Architecture", "Design", "Verification"):
                directory = project / root
                directory.mkdir(parents=True)
                (directory / "README.md").write_text(f"# {root}\n", encoding="utf-8")
            command = [
                sys.executable,
                "-X",
                "utf8",
                str(REPO_ROOT / "tools" / "processor-skills.py"),
                "check-docs",
                str(project),
                "--json",
            ]
            completed = subprocess.run(
                command,
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            report = json.loads(completed.stdout)
            self.assertTrue(report["ok"])

    def test_json_mode_keeps_configuration_errors_structured(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            command = [
                sys.executable,
                "-X",
                "utf8",
                str(REPO_ROOT / "tools" / "processor-skills.py"),
                "--repo-root",
                temp_name,
                "doctor",
                "--json",
            ]
            completed = subprocess.run(
                command,
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
            )
            self.assertEqual(completed.returncode, 3)
            report = json.loads(completed.stdout)
            self.assertFalse(report["ok"])
            self.assertEqual(report["error"]["kind"], "configuration")

    def test_cmd_wrapper_returns_nonzero_for_argument_parse_errors(self) -> None:
        completed = subprocess.run(
            [str(REPO_ROOT / "scripts" / "read-text.cmd")],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("required", completed.stderr)

    @unittest.skipUnless(
        os.environ.get("PROCESSOR_SKILLS_RUN_CHISEL_SMOKE") == "1",
        "set PROCESSOR_SKILLS_RUN_CHISEL_SMOKE=1 for the live toolchain test",
    )
    def test_live_cmd_transport_preserves_edge_arguments(self) -> None:
        runtime = REPO_ROOT / ".runtime" / "processor-development-skills"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="argument transport 处理器 ", dir=runtime) as temp_name:
            root = Path(temp_name)
            project = root / "project"
            project.mkdir()
            probe = root / "argv_probe.py"
            probe.write_text(
                "import json, sys\nprint(json.dumps(sys.argv[1:], ensure_ascii=False))\n",
                encoding="utf-8",
            )
            batch = root / "argv probe.cmd"
            batch.write_text(
                "@echo off\r\n"
                + subprocess.list2cmdline([sys.executable, "-X", "utf8", str(probe)])
                + " %*\r\n"
                + "exit /b %ERRORLEVEL%\r\n",
                encoding="utf-8",
            )
            arguments = [
                "multi word",
                "",
                'nested "quote"',
                "处理器参数",
                "C:\\path with space\\",
            ]
            entrypoints = (
                [str(REPO_ROOT / "scripts" / "run.cmd"), "chisel-run"],
                [str(REPO_ROOT / "scripts" / "chisel-run.cmd")],
            )
            for entrypoint in entrypoints:
                completed = subprocess.run(
                    [
                        *entrypoint,
                        "--json",
                        str(project),
                        "--",
                        str(batch),
                        *arguments,
                    ],
                    cwd=REPO_ROOT.parent,
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="strict",
                    shell=False,
                    timeout=60,
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    completed.stderr + completed.stdout,
                )
                report = json.loads(completed.stdout)
                self.assertEqual(report["requestedCommand"], [str(batch), *arguments])
                self.assertEqual(report["resolvedCommand"], [str(batch), *arguments])
                self.assertEqual(report["launchedCommand"], [str(batch), *arguments])
                self.assertEqual(json.loads(report["stdout"]), arguments)

            failed = subprocess.run(
                [
                    str(REPO_ROOT / "scripts" / "chisel-run.cmd"),
                    "--json",
                    str(project),
                    "--",
                    "cmd.exe",
                    "/d",
                    "/c",
                    "exit",
                    "23",
                ],
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="strict",
                shell=False,
                timeout=60,
            )
            self.assertEqual(failed.returncode, 4)
            failed_report = json.loads(failed.stdout)
            self.assertFalse(failed_report["ok"])
            self.assertEqual(failed_report["childExitCode"], 23)

            missing = subprocess.run(
                [
                    str(REPO_ROOT / "scripts" / "chisel-run.cmd"),
                    "--json",
                    str(project),
                    "--",
                    "processor-skills-missing-command-9f4c2e7a.exe",
                ],
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="strict",
                shell=False,
                timeout=60,
            )
            self.assertEqual(missing.returncode, 4)
            missing_report = json.loads(missing.stdout)
            self.assertFalse(missing_report["ok"])
            self.assertEqual(missing_report["error"]["kind"], "external_command")

    @unittest.skipUnless(
        os.environ.get("PROCESSOR_SKILLS_RUN_CHISEL_SMOKE") == "1",
        "set PROCESSOR_SKILLS_RUN_CHISEL_SMOKE=1 for the live toolchain test",
    )
    def test_live_chisel_smoke_from_non_project_directory(self) -> None:
        fixture = REPO_ROOT / "tests" / "fixtures" / "chisel-smoke"
        runtime = REPO_ROOT / ".runtime" / "processor-development-skills"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="smoke project 空格 ", dir=runtime) as temp_name:
            project = Path(temp_name)
            shutil.copy2(fixture / "build.sbt", project / "build.sbt")
            shutil.copytree(fixture / "project", project / "project")
            shutil.copytree(fixture / "src", project / "src")
            command = [
                sys.executable,
                "-X",
                "utf8",
                str(REPO_ROOT / "tools" / "processor-skills.py"),
                "chisel-run",
                "--json",
                str(project),
                "--",
                "sbt",
                "-batch",
                "test",
            ]
            completed = subprocess.run(
                command,
                cwd=REPO_ROOT.parent,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
                timeout=600,
            )
            self.assertEqual(
                completed.returncode, 0, completed.stderr + completed.stdout
            )
            report = json.loads(completed.stdout)
            self.assertTrue(report["ok"])
            self.assertEqual(report["childExitCode"], 0)
            self.assertEqual(report["support"]["project"]["mode"], "subst_alias")
            self.assertEqual(
                report["support"]["environmentOverrides"]["CHISEL_PROJECT_ROOT"],
                report["support"]["project"]["aliasRoot"],
            )
            self.assertIn("SmokeCounterSpec", report["stdout"])

        with tempfile.TemporaryDirectory(
            prefix="long-ascii-project-root-" + ("x" * 48), dir=runtime
        ) as temp_name:
            project = Path(temp_name)
            shutil.copy2(fixture / "build.sbt", project / "build.sbt")
            shutil.copytree(fixture / "project", project / "project")
            shutil.copytree(fixture / "src", project / "src")
            completed = subprocess.run(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    str(REPO_ROOT / "tools" / "processor-skills.py"),
                    "chisel-run",
                    "--json",
                    str(project),
                    "--",
                    "sbt",
                    "-batch",
                    "test",
                ],
                cwd=REPO_ROOT.parent,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
                timeout=600,
            )
            self.assertEqual(
                completed.returncode, 0, completed.stderr + completed.stdout
            )
            report = json.loads(completed.stdout)
            self.assertTrue(report["ok"])
            self.assertEqual(report["support"]["project"]["mode"], "subst_alias")
            self.assertEqual(
                report["support"]["environmentOverrides"]["CHISEL_PROJECT_ROOT"],
                report["support"]["project"]["aliasRoot"],
            )
            self.assertIn("SmokeCounterSpec", report["stdout"])


if __name__ == "__main__":
    unittest.main()
