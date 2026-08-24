from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "sync_catalog.py"
SPEC = importlib.util.spec_from_file_location("sync_catalog", MODULE_PATH)
assert SPEC and SPEC.loader
SYNC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SYNC
SPEC.loader.exec_module(SYNC)


class CatalogParserTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture = ROOT / "tests" / "fixtures" / "library-sample.html"
        self.models = SYNC.parse_library(fixture.read_text(encoding="utf-8"))

    def test_extracts_complete_model(self) -> None:
        self.assertEqual(len(self.models), 1)
        model = self.models[0]
        self.assertEqual(model["slug"], "gemma-test")
        self.assertEqual(model["description"], "A small model for parser tests.")
        self.assertEqual(model["capabilities"], ["vision"])
        self.assertEqual(model["sizes"], ["4b"])
        self.assertEqual(model["pulls"], "1.2M")
        self.assertEqual(model["pullCount"], 1_200_000)
        self.assertEqual(model["tagCount"], 7)
        self.assertEqual(model["updatedAt"], "2026-08-24T03:30:00Z")
        self.assertEqual(model["runCommand"], "ollama run gemma-test")

    def test_validation_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            SYNC.validate(self.models, minimum=2)


if __name__ == "__main__":
    unittest.main()
