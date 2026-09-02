from __future__ import annotations

import re
import unittest
from pathlib import Path


class SkillPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill_root = Path(__file__).resolve().parents[1]
        cls.skill_text = (cls.skill_root / "SKILL.md").read_text(encoding="utf-8")

    def frontmatter(self) -> str:
        match = re.match(r"^---\n(.*?)\n---", self.skill_text, re.DOTALL)
        self.assertIsNotNone(match, "SKILL.md frontmatter is missing")
        return match.group(1)

    def test_frontmatter_and_name(self) -> None:
        frontmatter = self.frontmatter()
        top_level_keys = {
            line.split(":", 1)[0]
            for line in frontmatter.splitlines()
            if line and not line[0].isspace()
        }
        self.assertLessEqual(
            top_level_keys,
            {"name", "description", "license", "allowed-tools", "metadata"},
        )

        name_match = re.search(r"^name:\s*(.+)$", frontmatter, re.MULTILINE)
        description_match = re.search(
            r"^description:\s*(.+)$", frontmatter, re.MULTILINE
        )
        self.assertIsNotNone(name_match)
        self.assertIsNotNone(description_match)

        name = name_match.group(1).strip()
        description = description_match.group(1).strip()
        self.assertEqual(name, "organize-processor-docs")
        self.assertRegex(name, r"^[a-z0-9-]+$")
        self.assertLessEqual(len(name), 64)
        self.assertLessEqual(len(description), 1024)
        self.assertNotRegex(description, r"[<>]")
        self.assertNotIn("[TODO:", self.skill_text)

    def test_routed_references_exist(self) -> None:
        references = set(
            re.findall(r"\]\((references/[^)#]+\.md)\)", self.skill_text)
        )
        self.assertEqual(
            references,
            {
                "references/adr.md",
                "references/architecture.md",
                "references/bootstrap.md",
                "references/design.md",
                "references/maintenance.md",
                "references/protocol-lifecycle.md",
                "references/research-review.md",
                "references/verification.md",
            },
        )
        for reference in references:
            self.assertTrue((self.skill_root / reference).is_file(), reference)

    def test_ui_metadata(self) -> None:
        ui_text = (self.skill_root / "agents" / "openai.yaml").read_text(
            encoding="utf-8"
        )
        short_match = re.search(
            r'^\s*short_description:\s*"([^"]+)"', ui_text, re.MULTILINE
        )
        self.assertIsNotNone(short_match)
        short_description = short_match.group(1)
        self.assertGreaterEqual(len(short_description), 25)
        self.assertLessEqual(len(short_description), 64)
        self.assertIn("$organize-processor-docs", ui_text)

    def test_authority_and_diagram_rules_are_precise(self) -> None:
        self.assertIn(
            "Treat explicit user decisions and the current Git authorities as authoritative.",
            self.skill_text,
        )
        self.assertIn(
            "Treat a later user statement as change intent unless the user clearly supersedes an existing fact.",
            self.skill_text,
        )
        self.assertNotIn(
            "Treat the user's latest statement as authoritative",
            self.skill_text,
        )
        self.assertIn("every explanatory raster diagram", self.skill_text)
        self.assertIn("Evidence captures", self.skill_text)

    def test_instruction_files_fit_context_budget(self) -> None:
        instruction_files = [self.skill_root / "SKILL.md"] + sorted(
            (self.skill_root / "references").glob("*.md")
        )
        for path in instruction_files:
            text = path.read_text(encoding="utf-8")
            effective_chars = sum(
                1 for character in text if not character.isspace()
            )
            non_blank_lines = sum(1 for line in text.splitlines() if line.strip())
            self.assertLessEqual(effective_chars, 12000, path.name)
            self.assertLessEqual(non_blank_lines, 250, path.name)


if __name__ == "__main__":
    unittest.main()
