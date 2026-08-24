# ailocal.click

A fast, beginner-friendly directory of every base model currently listed in
Ollama's official model library.

## What it does

- synchronizes the complete official Ollama library listing with a standard-library Python script;
- builds one searchable directory and one static detail page per model with Astro and TypeScript;
- explains Ollama from first use through local APIs and coding-agent integrations;
- privately synchronizes signed-in users through Supabase with row-level security;
- provides profiles with avatars, selected model tags, notes, operating system, RAM/GPU preferences, filters, remove, and JSON/CSV export;
- copies a visible `ollama run <model>` command and shows OS-aware Terminal steps;
- leaves the paste-and-run action entirely under the user's control;
- deploys as a static GitHub Pages site and refreshes the catalog every six hours.

## Stack

- Astro and TypeScript for static pages and typed catalog data
- CSS for the adaptive visual system
- browser JavaScript and Supabase Auth for search, filters, password accounts, private sync, profiles, and Copy & run guidance
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
Supabase project before enabling the variables. Email/password authentication,
email confirmation, and password recovery are the default flow. Google and Apple
buttons can be enabled separately after their provider credentials are configured by setting
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

## Copy & run behavior

Selecting a model validates its catalog slug, copies the exact visible
`ollama run <model>` command, and shows instructions adapted for macOS, Windows,
or Linux. If the model is not installed, Ollama downloads it before starting it.

A website cannot open, paste into, or execute Terminal commands. The user opens
Terminal, pastes the command, and presses Enter. ailocal.click does not contact a
local service, change browser network permissions, or install a helper program.

Saving requires sign-in. Each user gets a separate RLS-protected Supabase list.
An earlier browser-only list, when present from a previous release, can be imported
once after sign-in and is then removed. The My models page supports selected tags,
notes, compatibility guidance, search, capability filters, sorting, removal,
clearing, and JSON/CSV export.
