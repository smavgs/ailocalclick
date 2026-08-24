# ailocal.click

A fast, beginner-friendly directory of every base model currently listed in
Ollama's official model library.

## What it does

- synchronizes the complete official Ollama library listing with a standard-library Python script;
- builds one searchable directory and one static detail page per model with Astro and TypeScript;
- explains Ollama from first use through local APIs and coding-agent integrations;
- saves locally for guests and privately synchronizes signed-in users through Supabase;
- provides profiles with avatars, selected model tags, notes, operating system, RAM/GPU preferences, filters, remove, and JSON/CSV export;
- asks the local Ollama `/api/pull` endpoint to download only after explicit confirmation;
- keeps a visible copy-command fallback when the browser cannot reach local Ollama;
- deploys as a static GitHub Pages site and refreshes the catalog every six hours.

## Stack

- Astro and TypeScript for static pages and typed catalog data
- CSS for the adaptive visual system
- browser JavaScript and Supabase Auth for search, filters, account sync, profiles, and streamed Ollama download progress
- Python for official catalog synchronization
- Shell for one-command sync and verification

## Local development

Requirements: Node.js 22.12 or newer and Python 3.11 or newer.

```sh
npm install
npm run sync
npm run dev
```

Open the local URL printed by Astro.

Account features require these public build variables:

```sh
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Apply `supabase/migrations/202608240001_account_profiles.sql` to a dedicated
Supabase project before enabling the variables. Email magic-link authentication
is the default. Google and Apple buttons can be enabled separately after their
provider credentials are configured by setting
`PUBLIC_ENABLE_GOOGLE_AUTH=true` or `PUBLIC_ENABLE_APPLE_AUTH=true`.

## Verification

```sh
npm run verify
```

This runs the Python parser tests, Astro type checks, a production build, and a
minimum catalog-size assertion.

## Data scope and provenance

The generated `src/data/models.json` file is derived only from
`https://ollama.com/library?sort=newest`. It covers base models presented in the
official library. Ollama's open-ended community search namespaces are not
enumerated, and exact tags, licenses, context lengths, and file sizes should be
confirmed on each linked official Ollama page before downloading.

Ollama names and model metadata belong to their respective owners. This project
is an independent directory and is not affiliated with Ollama.

## Local download behavior

The download button checks `http://localhost:11434/api/version` and, after the
user's click, posts the catalog slug to `http://localhost:11434/api/pull` with
streaming enabled. Model identifiers are validated against a conservative slug
format before a request is made. No request to localhost happens on page load.

Browsers and Ollama can block cross-origin local-network requests. The UI keeps
the copy command available and links to exact-origin setup help. Do not configure
`OLLAMA_ORIGINS=*`; allow only the website origin that needs access.

Guest models use the `ailocalclick:saved-models:v1` local-storage key. Signed-in
users get a separate RLS-protected Supabase list and can import any missing guest
saves without erasing the local copy. The My models page supports selected tags,
notes, compatibility guidance, search, capability filters, sorting, removal,
clearing, and JSON/CSV export.
