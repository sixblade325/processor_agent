from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from check_docs import check_project


class CheckDocsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write(self, relative_path: str, content: str) -> None:
        path = self.project / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_bytes(self, relative_path: str, content: bytes) -> None:
        path = self.project / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def codes(self, report: dict[str, object]) -> list[str]:
        return [str(item["code"]) for item in report["issues"]]

    def test_valid_project(self) -> None:
        self.write(
            "Architecture/README.md",
            "# Architecture\n\n[目标](目标.md#处理器目标)\n",
        )
        self.write("Architecture/目标.md", "# 处理器目标\n\n支持可验证执行。\n")
        self.write("Design/README.md", "# Design\n\n[概述](概述.md)\n")
        self.write("Design/概述.md", "# 概述\n\n描述当前设计。\n")
        self.write(
            "Verification/README.md",
            "# Verification\n\n[计划](计划.md)\n",
        )
        self.write("Verification/计划.md", "# 计划\n\n检查目标性质。\n")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["filesChecked"], 6)
        self.assertIn(
            "Architecture/目标.md",
            [item["path"] for item in report["measurements"]],
        )

    def test_canonical_doc_layout_and_overall_entry(self) -> None:
        self.write(
            "doc/README.md",
            "# Documentation\n\n[Architecture](Architecture/README.md)\n\n"
            "[Design](Design/README.md)\n\n"
            "[Verification](Verification/README.md)\n",
        )
        self.write(
            "doc/Architecture/README.md",
            "# Architecture\n\n[目标](目标.md)\n",
        )
        self.write("doc/Architecture/目标.md", "# 目标\n")
        self.write("doc/Design/README.md", "# Design\n\n[概述](OVERVIEW.md)\n")
        self.write("doc/Design/OVERVIEW.md", "# Overview\n")
        self.write("doc/Verification/README.md", "# Verification\n")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["layout"], "doc")
        self.assertEqual(
            report["roots"],
            ["doc/Architecture", "doc/Design", "doc/Verification"],
        )
        self.assertEqual(report["filesChecked"], 6)
        self.assertNotIn("noncanonical_document_layout", self.codes(report))

    def test_canonical_doc_layout_requires_overall_entry(self) -> None:
        self.write("doc/Design/README.md", "# Design\n")

        report = check_project(self.project)

        self.assertFalse(report["ok"])
        self.assertIn("missing_doc_entry", self.codes(report))

    def test_overall_entry_must_link_each_domain_directly(self) -> None:
        self.write("doc/README.md", "# Documentation\n\n[Design](Design/README.md)\n")
        self.write("doc/Architecture/README.md", "# Architecture\n")
        self.write("doc/Design/README.md", "# Design\n")

        report = check_project(self.project)
        domain_issues = [
            item
            for item in report["issues"]
            if item["code"] == "document_domain_not_linked"
        ]

        self.assertEqual(len(domain_issues), 1)
        self.assertIn("doc/Architecture/README.md", domain_issues[0]["message"])

    def test_legacy_top_level_layout_warns(self) -> None:
        self.write("Design/README.md", "# Design\n")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["layout"], "legacy_top_level")
        self.assertIn("noncanonical_document_layout", self.codes(report))

    def test_canonical_and_top_level_domain_roots_are_rejected(self) -> None:
        self.write("doc/README.md", "# Documentation\n\n[Design](Design/README.md)\n")
        self.write("doc/Design/README.md", "# Design\n")
        self.write("Design/README.md", "# Legacy Design\n")

        report = check_project(self.project)

        self.assertFalse(report["ok"])
        self.assertIn("duplicate_document_root", self.codes(report))

    def test_mixed_canonical_and_top_level_domains_are_rejected(self) -> None:
        self.write("doc/README.md", "# Documentation\n\n[Design](Design/README.md)\n")
        self.write("doc/Design/README.md", "# Design\n")
        self.write("Architecture/README.md", "# Architecture\n")

        report = check_project(self.project)

        self.assertFalse(report["ok"])
        self.assertIn("document_root_outside_doc", self.codes(report))

    def test_research_root_is_discovered(self) -> None:
        self.write("Research/README.md", "# Research\n\n[调研](调研.md)\n")
        self.write("Research/调研.md", "# 调研\n\n记录来源化证据。\n")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["roots"], ["Research"])
        profiles = {item["profile"] for item in report["measurements"]}
        self.assertEqual(profiles, {"readme", "research"})

    def test_finding_uses_short_budget(self) -> None:
        self.write(
            "Research/README.md",
            "# Research\n\n[Finding](findings/F_001.md)\n",
        )
        self.write("Research/findings/F_001.md", "# Finding\n\n" + ("x" * 4001))

        report = check_project(self.project)
        measurement = next(
            item
            for item in report["measurements"]
            if item["path"] == "Research/findings/F_001.md"
        )

        self.assertEqual(measurement["profile"], "finding")
        self.assertIn("hard_effective_chars_exceeded", self.codes(report))

    def test_target_budget_warns_and_json_reports_target_and_hard(self) -> None:
        self.write("Architecture/README.md", "# Architecture\n\n[目标](目标.md)\n")
        self.write("Architecture/目标.md", "# 目标\n\n" + ("字" * 6001))

        report = check_project(self.project)
        measurement = next(
            item
            for item in report["measurements"]
            if item["path"] == "Architecture/目标.md"
        )

        self.assertTrue(report["ok"], report["issues"])
        self.assertIn("target_effective_chars_exceeded", self.codes(report))
        self.assertEqual(report["warningCount"], 2)
        self.assertEqual(measurement["targetEffectiveChars"], 6000)
        self.assertEqual(measurement["targetNonBlankLines"], 140)
        self.assertEqual(measurement["hardEffectiveChars"], 10000)
        self.assertEqual(measurement["hardNonBlankLines"], 200)

    def test_hard_budget_policy_and_values_are_configurable(self) -> None:
        self.write("Architecture/README.md", "# Architecture\n\n[目标](目标.md)\n")
        self.write("Architecture/目标.md", "# 目标\n\n" + ("字" * 10001))

        warning_report = check_project(self.project)
        strict_report = check_project(self.project, hard_limit_policy="error")
        overridden_report = check_project(
            self.project,
            budget_overrides={
                "architecture": {
                    "targetEffectiveChars": 11000,
                    "hardEffectiveChars": 15000,
                }
            },
        )

        self.assertTrue(warning_report["ok"])
        self.assertIn("hard_effective_chars_exceeded", self.codes(warning_report))
        self.assertFalse(strict_report["ok"])
        strict_issue = next(
            item
            for item in strict_report["issues"]
            if item["code"] == "hard_effective_chars_exceeded"
        )
        self.assertEqual(strict_issue["severity"], "error")
        self.assertTrue(overridden_report["ok"], overridden_report["issues"])
        self.assertNotIn(
            "hard_effective_chars_exceeded", self.codes(overridden_report)
        )

    def test_cli_loads_budget_config(self) -> None:
        self.write("Design/README.md", "# Design\n\n[模块](module.md)\n")
        self.write("Design/module.md", "# Module\n\n" + ("x" * 12001))
        self.write(
            "budget.json",
            json.dumps(
                {
                    "design": {
                        "targetEffectiveChars": 13000,
                        "hardEffectiveChars": 16000,
                    }
                }
            ),
        )
        script = Path(__file__).with_name("check_docs.py")

        completed = subprocess.run(
            [
                sys.executable,
                "-B",
                str(script),
                str(self.project),
                "--json",
                "--budget-config",
                str(self.project / "budget.json"),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        report = json.loads(completed.stdout.decode("utf-8"))
        measurement = next(
            item
            for item in report["measurements"]
            if item["path"] == "Design/module.md"
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(measurement["targetEffectiveChars"], 13000)
        self.assertEqual(measurement["hardEffectiveChars"], 16000)
        self.assertNotIn("hard_effective_chars_exceeded", self.codes(report))

    def test_cli_emits_utf8_paths(self) -> None:
        self.write("Design/README.md", "# Design\n\n[协议](协议.md)\n")
        self.write("Design/协议.md", "# 协议\n")
        script = Path(__file__).with_name("check_docs.py")

        completed = subprocess.run(
            [sys.executable, "-B", str(script), str(self.project), "--json"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout.decode("utf-8"))
        self.assertIn(
            "Design/协议.md",
            [item["path"] for item in report["measurements"]],
        )
        measurement = next(
            item
            for item in report["measurements"]
            if item["path"] == "Design/协议.md"
        )
        self.assertEqual(measurement["targetEffectiveChars"], 8000)
        self.assertEqual(measurement["hardEffectiveChars"], 12000)

    def test_reports_length_and_missing_anchor(self) -> None:
        self.write(
            "Architecture/README.md",
            "# Architecture\n\n[目标](目标.md#不存在)\n",
        )
        self.write("Architecture/目标.md", "# 目标\n\n" + ("字" * 10001))

        report = check_project(self.project)
        codes = self.codes(report)

        self.assertIn("broken_anchor", codes)
        self.assertIn("hard_effective_chars_exceeded", codes)

    def test_reports_broken_link_and_orphan(self) -> None:
        self.write(
            "Design/README.md",
            "# Design\n\n[缺失](missing.md)\n",
        )
        self.write("Design/orphan.md", "# Orphan\n")

        report = check_project(self.project)
        codes = self.codes(report)

        self.assertIn("broken_link", codes)
        self.assertIn("orphan_document", codes)

    def test_reports_reading_path_deeper_than_two_links(self) -> None:
        self.write("Design/README.md", "# Design\n\n[A](a.md)\n")
        self.write("Design/a.md", "# A\n\n[B](b.md)\n")
        self.write("Design/b.md", "# B\n\n[C](c.md)\n")
        self.write("Design/c.md", "# C\n")

        report = check_project(self.project)
        deep_issues = [
            item
            for item in report["issues"]
            if item["code"] == "reading_path_too_deep"
        ]

        self.assertEqual(len(deep_issues), 1)
        self.assertEqual(deep_issues[0]["path"], "Design/c.md")

    def test_duplicate_heading_anchor_uses_numbered_suffix(self) -> None:
        self.write(
            "Architecture/README.md",
            "# Architecture\n\n[第二个重复标题](topic.md#重复-1)\n",
        )
        self.write(
            "Architecture/topic.md",
            "# Topic\n\n## 重复\n\n内容。\n\n## 重复\n\n更多内容。\n",
        )

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])
        self.assertNotIn("broken_anchor", self.codes(report))

    def test_custom_root_is_checked(self) -> None:
        self.write("docs/README.md", "# Docs\n\n[主题](topic.md)\n")
        self.write("docs/topic.md", "# 主题\n")

        report = check_project(self.project, ["docs"])

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["roots"], ["docs"])
        self.assertEqual(report["filesChecked"], 2)

    def test_reports_conflict_and_duplicate_tree(self) -> None:
        self.write(
            "Design/README.md",
            "# Design\n\n[旧树](FinalDesign/current.md)\n\n"
            "[备份](ZJRDesignBackup/backup.md)\n\n"
            "[旧目录](old queue/old.md)\n",
        )
        self.write(
            "Design/FinalDesign/current.md",
            "# Current\n\n<<<<<<< ours\ntext\n>>>>>>> theirs\n",
        )
        self.write("Design/ZJRDesignBackup/backup.md", "# Backup\n")
        self.write("Design/old queue/old.md", "# Old\n")

        report = check_project(self.project)
        codes = self.codes(report)

        self.assertIn("conflict_marker", codes)
        self.assertIn("duplicate_current_tree", codes)
        self.assertEqual(codes.count("duplicate_current_tree"), 3)

    def test_rendered_diagram_requires_editable_source(self) -> None:
        self.write("Design/README.md", "# Design\n\n[概述](overview.md)\n")
        self.write(
            "Design/overview.md",
            "# Overview\n\n![拓扑](pics/topology.png)\n",
        )
        self.write("Design/pics/topology.png", "not-a-real-image")

        missing_source = check_project(self.project)
        self.assertIn(
            "missing_editable_diagram_source", self.codes(missing_source)
        )

        self.write("Design/pics/topology.drawio", "<mxfile />")
        with_source = check_project(self.project)
        self.assertTrue(with_source["ok"], with_source["issues"])

    def test_verification_screenshot_does_not_require_editable_source(self) -> None:
        self.write(
            "Verification/README.md",
            "# Verification\n\n[结果](result.md)\n",
        )
        self.write(
            "Verification/result.md",
            "# Result\n\nInput commit: abc123\n\n"
            "Method: simulation\n\n"
            "![波形截图](evidence/wave.png)\n\n"
            "Evidence source: [run log](evidence/run.log)\n",
        )
        self.write("Verification/evidence/wave.png", "not-a-real-image")
        self.write("Verification/evidence/run.log", "simulation output")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])

    def test_verification_explanatory_raster_requires_editable_source(self) -> None:
        self.write(
            "Verification/README.md",
            "# Verification\n\n[环境](environment.md)\n",
        )
        self.write(
            "Verification/environment.md",
            "# Environment\n\n![验证拓扑](images/topology.png)\n",
        )
        self.write("Verification/images/topology.png", "not-a-real-image")

        report = check_project(self.project)

        self.assertIn("missing_editable_diagram_source", self.codes(report))

    def test_reference_link_is_reachable(self) -> None:
        self.write(
            "Design/README.md",
            "# Design\n\n[概述][overview]\n\n[overview]: overview.md\n",
        )
        self.write("Design/overview.md", "# Overview\n")

        report = check_project(self.project)

        self.assertTrue(report["ok"], report["issues"])

    def test_reports_absolute_file_link(self) -> None:
        self.write(
            "Architecture/README.md",
            "# Architecture\n\n[外部](file:///tmp/outside.md)\n",
        )

        report = check_project(self.project)

        self.assertIn("absolute_local_link", self.codes(report))

    def test_non_utf8_markdown_reports_encoding_error(self) -> None:
        self.write("Design/README.md", "# Design\n\n[历史文档](legacy.md)\n")
        self.write_bytes("Design/legacy.md", b"# Legacy\n\n\xff\xfeinvalid")

        report = check_project(self.project)

        self.assertFalse(report["ok"])
        self.assertEqual(self.codes(report).count("encoding_error"), 1)

    def test_parallel_candidate_design_root_is_rejected(self) -> None:
        self.write("Design/README.md", "# Design\n")
        self.write("DesignCandidate/README.md", "# Candidate Design\n")

        report = check_project(self.project)

        duplicate_issues = [
            item
            for item in report["issues"]
            if item["code"] == "duplicate_current_tree"
        ]
        self.assertEqual(len(duplicate_issues), 1)
        self.assertEqual(duplicate_issues[0]["path"], "DesignCandidate")

    def test_parallel_candidate_design_root_under_doc_is_rejected(self) -> None:
        self.write("doc/README.md", "# Documentation\n\n[Design](Design/README.md)\n")
        self.write("doc/Design/README.md", "# Design\n")
        self.write("doc/DesignCandidate/README.md", "# Candidate Design\n")

        report = check_project(self.project)
        duplicate_issues = [
            item
            for item in report["issues"]
            if item["code"] == "duplicate_current_tree"
        ]

        self.assertEqual(len(duplicate_issues), 1)
        self.assertEqual(duplicate_issues[0]["path"], "doc/DesignCandidate")


if __name__ == "__main__":
    unittest.main()
