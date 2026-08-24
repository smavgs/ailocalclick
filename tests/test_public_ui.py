from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicUiContractTests(unittest.TestCase):
    def test_requested_copy_is_removed(self) -> None:
        public_sources = "\n".join(
            (ROOT / path).read_text()
            for path in (
                "src/pages/index.astro",
                "src/pages/about.astro",
                "src/components/Footer.astro",
            )
        )
        for removed in (
            "Static Astro build",
            "Synced {syncDate} UTC",
            "Every model in Ollama’s official library. One fast, searchable directory.",
            "I’m new to Ollama",
            "An independent, read-only directory",
            "The current snapshot contains",
            "Astro and TypeScript generate static pages",
        ):
            self.assertNotIn(removed, public_sources)

    def test_required_copy_and_local_features_are_present(self) -> None:
        index = (ROOT / "src/pages/index.astro").read_text()
        footer = (ROOT / "src/components/Footer.astro").read_text()
        dialog = (ROOT / "src/components/OllamaPullDialog.astro").read_text()
        site_script = (ROOT / "src/scripts/site.ts").read_text()
        saved_page = (ROOT / "src/pages/saved.astro").read_text()

        self.assertIn(">I'm new</a>", index)
        self.assertIn("Click &amp; build with ai open models, on your computer.", footer)
        self.assertIn("data-pull-start", dialog)
        self.assertIn('fetch(`${apiBase}/pull`', site_script)
        self.assertIn("ailocalclick:saved-models:v1", site_script)
        self.assertIn("data-saved-page", saved_page)


if __name__ == "__main__":
    unittest.main()
