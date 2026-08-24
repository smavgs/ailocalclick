# ailocal.click

Fast, beginner-friendly Click & build with ai open models, on your computer . FREE

Live site: [ailocalclick.pages.dev](https://ailocalclick.pages.dev/)

Fallback: [smavgs.github.io/ailocalclick](https://smavgs.github.io/ailocalclick/)

## What it does

- synchronizes the complete official Ollama library listing with a standard-library Python script;
- builds one searchable directory and one static detail page per model with Astro and TypeScript;
- explains Ollama from first use through local APIs and coding-agent integrations;
- supports email, Google, and GitHub sign-in, then privately synchronizes each user through Supabase with row-level security;
- provides profiles with avatars, selected model tags, notes, operating system, RAM/GPU preferences, filters, remove, and JSON/CSV export;
- supports English, Russian, Korean, Japanese, and Simplified Chinese without duplicating the static catalog;
- copies a visible `ollama run <model>` command and shows OS-aware Terminal steps;
- leaves the paste-and-run action entirely under the user's control;
- deploys as a static Cloudflare Pages site, retains GitHub Pages as a fallback, and refreshes the catalog every six hours.

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
PUBLIC_ENABLE_GOOGLE_AUTH=true
PUBLIC_ENABLE_GITHUB_AUTH=true
PUBLIC_TURNSTILE_SITE_KEY=your_public_turnstile_site_key
```

Apply supabase to a dedicated Supabase project before enabling the variables. Email/password authentication, email confirmation, and password recovery use custom production SMTP. Google and GitHub buttons can be enabled separately after their provider credentials are configured. When Turnstile protection is enabled in Supabase Auth, the matching public site key must be present in every production build.

For Cloudflare Pages, use `npm run build`, publish `dist`, and set
`PUBLIC_SITE_URL` to the production origin with `PUBLIC_BASE_PATH=/`.

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

Account support: [corporate@agentmail.to](mailto:corporate@agentmail.to).
