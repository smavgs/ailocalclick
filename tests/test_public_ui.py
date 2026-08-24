from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicUiContractTests(unittest.TestCase):
    def test_requested_copy_is_removed(self) -> None:
        public_sources = "\n".join(
            (ROOT / path).read_text()
            for path in (
                "src/pages/index.astro",
                "src/pages/about.astro",
                "src/components/Header.astro",
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
            "Open models, clearly indexed",
            "Fast to browse.",
            "Your click stays in control.",
            "Source-bounded.",
        ):
            self.assertNotIn(removed, public_sources)

        footer = (ROOT / "src/components/Footer.astro").read_text()
        self.assertNotIn("Ollama docs", footer)

    def test_required_copy_and_account_features_are_present(self) -> None:
        index = (ROOT / "src/pages/index.astro").read_text()
        footer = (ROOT / "src/components/Footer.astro").read_text()
        header = (ROOT / "src/components/Header.astro").read_text()
        dialog = (ROOT / "src/components/CopyRunDialog.astro").read_text()
        site_script = (ROOT / "src/scripts/site.ts").read_text()
        account_script = (ROOT / "src/scripts/account.ts").read_text()
        saved_page = (ROOT / "src/pages/saved.astro").read_text()
        profile_page = (ROOT / "src/pages/profile.astro").read_text()
        account_dialog = (ROOT / "src/components/AccountDialog.astro").read_text()

        self.assertIn(">I'm new</a>", index)
        self.assertIn("Click &amp; build with ai open models, on your computer.", index)
        self.assertIn("Click &amp; build with ai open models, on your computer.", footer)
        self.assertIn("data-auth-open", header)
        self.assertIn("data-copy-run-again", dialog)
        self.assertIn("data-open-copy-run", site_script)
        self.assertIn("navigator.clipboard.writeText", site_script)
        self.assertNotIn("/api/pull", site_script)
        self.assertNotIn("OLLAMA_ORIGINS", site_script)
        self.assertIn("ailocalclick:saved-models:v1", account_script)
        self.assertIn("signInWithPassword", account_script)
        self.assertIn("signUp", account_script)
        self.assertIn("resetPasswordForEmail", account_script)
        self.assertIn("Sign in to save models to your private list.", account_script)
        self.assertNotIn("guestSavedRecords", account_script)
        self.assertIn('from("saved_models")', account_script)
        self.assertIn("data-saved-page", saved_page)
        self.assertIn("data-saved-note", (ROOT / "src/components/ModelRow.astro").read_text())
        self.assertIn("data-profile-form", profile_page)
        self.assertIn('data-auth-provider="google"', account_dialog)
        self.assertIn('data-auth-provider="github"', account_dialog)
        self.assertNotIn('data-auth-provider="apple"', account_dialog)
        self.assertIn("data-turnstile-shell", account_dialog)
        self.assertIn("captchaToken", account_script)
        self.assertIn("corporate@agentmail.to", footer)

    def test_all_supported_languages_have_the_same_full_ui_contract(self) -> None:
        key_pattern = re.compile(r'^\s*"((?:[^"\\]|\\.)+)":', re.MULTILINE)
        language_files = [
            ROOT / "src/i18n/ru.ts",
            ROOT / "src/i18n/ko.ts",
            ROOT / "src/i18n/ja.ts",
            ROOT / "src/i18n/zh-CN.ts",
        ]
        key_sets = []
        for path in language_files:
            keys = key_pattern.findall(path.read_text(encoding="utf-8"))
            self.assertEqual(len(keys), len(set(keys)), f"duplicate translation key in {path.name}")
            self.assertGreaterEqual(len(keys), 390, f"incomplete translation catalog in {path.name}")
            key_sets.append(set(keys))
        for keys in key_sets[1:]:
            self.assertEqual(key_sets[0], keys)

        header = (ROOT / "src/components/Header.astro").read_text()
        for locale in ("en", "ru", "ko", "ja", "zh-CN"):
            self.assertIn(f'value="{locale}"', header)

    def test_copy_run_replaces_browser_local_pull_setup(self) -> None:
        sources = "\n".join(
            path.read_text()
            for path in (
                ROOT / "src/scripts/site.ts",
                ROOT / "src/pages/learn.astro",
                ROOT / "src/pages/about.astro",
                ROOT / "README.md",
            )
        )
        for removed in ("/api/pull", "OLLAMA_ORIGINS", "Download with Ollama"):
            self.assertNotIn(removed, sources)
        self.assertIn("Copy &amp; run", (ROOT / "src/components/CopyRunDialog.astro").read_text())

    def test_supabase_migration_has_rls(self) -> None:
        migration = (ROOT / "supabase/migrations/202608240001_account_profiles.sql").read_text()
        lock_down = (ROOT / "supabase/migrations/202608240002_lock_down_trigger_functions.sql").read_text()
        self.assertIn("alter table public.profiles enable row level security", migration)
        self.assertIn("alter table public.saved_models enable row level security", migration)
        self.assertIn("(select auth.uid()) = user_id", migration)
        self.assertIn("avatars_insert_own_folder", migration)
        self.assertIn("revoke execute on function public.handle_new_user()", lock_down)


if __name__ == "__main__":
    unittest.main()
