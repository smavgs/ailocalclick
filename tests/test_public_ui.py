from pathlib import Path
import hashlib
import html
import json
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicUiContractTests(unittest.TestCase):
    def test_requested_copy_is_removed(self) -> None:
        public_sources = "\n".join(
            (ROOT / path).read_text()
            for path in (
                "src/pages/index.astro",
                "src/components/HomeContent.astro",
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
        index = "\n".join((ROOT / path).read_text() for path in (
            "src/pages/index.astro",
            "src/components/HomeContent.astro",
        ))
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
        self.assertNotIn("Click &amp; build with ai open models, on your computer.", footer)
        self.assertIn("https://donatr.ee/aegiswizard?utm_source=copy&amp;utm_medium=share", footer)
        self.assertIn(">Donate</a>", footer)
        self.assertIn("Aegis Wizard", footer)
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

    def test_localized_social_share_cards_and_routes(self) -> None:
        layout = (ROOT / "src/layouts/BaseLayout.astro").read_text(encoding="utf-8")
        localized_page = (ROOT / "src/pages/[locale]/index.astro").read_text(encoding="utf-8")
        i18n = (ROOT / "src/scripts/i18n.ts").read_text(encoding="utf-8")
        self.assertIn('content="summary_large_image"', layout)
        self.assertIn('property="og:image:width" content="1200"', layout)
        self.assertIn('property="og:image:height" content="630"', layout)
        self.assertIn('hreflang="x-default"', layout)
        self.assertIn("updateHomepageLocalePath", i18n)
        for route in ("ru", "ko", "ja", "zh-cn"):
            self.assertIn(f'{route}: {{' if route != "zh-cn" else '"zh-cn": {', localized_page)
        for locale in ("en", "ru", "ko", "ja", "zh-cn"):
            image = ROOT / f"public/social/ailocalclick-{locale}-v1.png"
            payload = image.read_bytes()
            self.assertEqual(b"\x89PNG\r\n\x1a\n", payload[:8])
            self.assertEqual(1200, int.from_bytes(payload[16:20], "big"))
            self.assertEqual(630, int.from_bytes(payload[20:24], "big"))
            self.assertGreater(len(payload), 20_000)

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

    def test_privacy_and_terms_are_fully_localized(self) -> None:
        legal_sources: set[str] = set()
        for page_name in ("privacy.astro", "terms.astro"):
            page = (ROOT / "src/pages" / page_name).read_text(encoding="utf-8")
            for attribute in ("title", "description"):
                legal_sources.update(
                    html.unescape(value)
                    for value in re.findall(rf'\b{attribute}="([^"]+)"', page)
                )
            for raw_value in re.findall(r">([^<>{]+)<", page):
                value = html.unescape(" ".join(raw_value.split()))
                if re.search(r"[A-Za-z]", value) and value != "corporate@agentmail.to":
                    legal_sources.add(value)

        self.assertEqual(40, len(legal_sources))
        scripts = {
            "ru": re.compile(r"[А-Яа-яЁё]"),
            "ko": re.compile(r"[가-힣]"),
            "ja": re.compile(r"[ぁ-んァ-ン一-龯]"),
            "zh-CN": re.compile(r"[\u3400-\u9fff]"),
        }
        pair_pattern = re.compile(
            r'^\s*"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)",?$',
            re.MULTILINE,
        )
        for locale, script in scripts.items():
            source = (ROOT / f"src/i18n/{locale}.ts").read_text(encoding="utf-8")
            translations = {
                json.loads(f'"{key}"'): json.loads(f'"{value}"')
                for key, value in pair_pattern.findall(source)
            }
            self.assertTrue(legal_sources.issubset(translations), f"missing {locale} legal translations")
            for legal_source in legal_sources:
                translated = translations[legal_source]
                self.assertNotEqual(legal_source, translated, f"untranslated {locale} legal copy: {legal_source}")
                self.assertRegex(translated, script, f"non-native {locale} legal copy: {legal_source}")

        layout = (ROOT / "src/layouts/BaseLayout.astro").read_text(encoding="utf-8")
        i18n = (ROOT / "src/scripts/i18n.ts").read_text(encoding="utf-8")
        self.assertGreaterEqual(layout.count("data-i18n-content"), 5)
        self.assertIn('meta[data-i18n-content]', i18n)
        self.assertIn("openGraphLocales[locale]", i18n)

    def test_every_model_description_has_current_native_translations(self) -> None:
        catalog = json.loads((ROOT / "src/data/models.json").read_text(encoding="utf-8"))
        models = catalog["models"]
        slugs = {model["slug"] for model in models}
        scripts = {
            "ru": re.compile(r"[А-Яа-яЁё]"),
            "ko": re.compile(r"[가-힣]"),
            "ja": re.compile(r"[ぁ-んァ-ン]"),
            "zh-CN": re.compile(r"[\u3400-\u9fff]"),
        }
        for locale, script in scripts.items():
            path = ROOT / f"src/i18n/model-descriptions/{locale}.json"
            translations = json.loads(path.read_text(encoding="utf-8"))
            translated_current = slugs.intersection(translations)
            self.assertGreaterEqual(len(translated_current), min(200, len(slugs)), f"insufficient {locale} model descriptions")
            for model in models:
                if model["slug"] not in translations:
                    continue
                entry = translations[model["slug"]]
                expected_hash = hashlib.sha256(entry["source"].encode("utf-8")).hexdigest()[:16]
                self.assertEqual(expected_hash, entry["sourceHash"], f"invalid {locale} source hash for {model['slug']}")
                self.assertTrue(script.search(entry["text"]), f"non-native {locale} translation for {model['slug']}")
                if locale == "ko":
                    self.assertNotRegex(entry["text"], r"[ぁ-んァ-ン\u3400-\u9fff]", f"mixed-script Korean for {model['slug']}")

        i18n = (ROOT / "src/scripts/i18n.ts").read_text(encoding="utf-8")
        row = (ROOT / "src/components/ModelRow.astro").read_text(encoding="utf-8")
        detail = (ROOT / "src/pages/model/[slug].astro").read_text(encoding="utf-8")
        self.assertIn("loadModelDescriptions", i18n)
        self.assertIn("modelDescriptionFallbacks", i18n)
        self.assertIn("data-model-description", row)
        self.assertIn("data-model-description", detail)

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
