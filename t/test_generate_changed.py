import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "generate_changed.py"
SPEC = importlib.util.spec_from_file_location("generate_changed", SCRIPT)
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


class ChangelogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.notes = self.root / "release-notes"
        self.notes.mkdir()
        (self.notes / "archive.txt").write_text("Historical entry\n\nFrühere Details\n", encoding="utf-8")

    def entry(self, filename, **overrides):
        data = {
            "date": "2026-11-11",
            "version": "1.7.0",
            "title": "Setup wizard",
            "changes": ["First change", "Second change"],
        }
        data.update(overrides)
        (self.notes / filename).write_text(json.dumps(data), encoding="utf-8")

    def test_summary_is_visible_to_fhem_and_history_is_preserved(self):
        self.entry("2026-11-11-stable.json")
        self.entry("2026-11-10-older.json", date="2026-11-10", version="1.6.1")
        result = generator.render(self.notes)
        visible = []
        for line in result.splitlines():
            if line.startswith("#"):
                continue
            if not line or line == "local FHEM changelog header":
                break
            visible.append(line)
        self.assertEqual(visible, [
            "2026-11-11 - 1.7.0: Setup wizard",
            "- First change",
            "- Second change",
        ])
        self.assertIn("2026-11-10 - 1.6.1: Setup wizard", result)
        self.assertTrue(result.endswith("Historical entry\n\nFrühere Details\n"))
        self.assertEqual(result, generator.render(self.notes))

    def test_rejects_bad_entries_and_oversized_summaries(self):
        filename = "2026-11-11-stable.json"
        for overrides in (
            {"changes": []},
            {"changes": ["first\nsecond"]},
            {"changes": ["A" * 80]},
            {"changes": ["Entry"] * 25},
            {"title": "Übersicht"},
            {"date": "2026-11-10"},
        ):
            with self.subTest(overrides=overrides):
                self.entry(filename, **overrides)
                with self.assertRaises(ValueError):
                    generator.render(self.notes)

    def test_script_writes_and_checks_output_without_installing_it(self):
        self.entry("2026-11-11-stable.json")
        script_dir = self.root / "scripts"
        script_dir.mkdir()
        script = script_dir / "generate_changed.py"
        script.write_bytes(SCRIPT.read_bytes())
        subprocess.run([sys.executable, str(script)], check=True)
        subprocess.run([sys.executable, str(script), "--check"], check=True)
        (self.root / "CHANGED").write_text("stale\n", encoding="ascii")
        result = subprocess.run(
            [sys.executable, str(script), "--check"], capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("out of date", result.stderr)


if __name__ == "__main__":
    unittest.main()
