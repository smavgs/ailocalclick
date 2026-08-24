# ailocal.click

A fast, beginner-friendly directory of every base model currently listed in
Ollama's official model library.

## What it does

- synchronizes the complete official Ollama library listing with a standard-library Python script;
- builds one searchable directory and one static detail page per model with Astro and TypeScript;
- explains Ollama from first use through local APIs and coding-agent integrations;
- copies commands only—this site never silently downloads or launches a model;
- deploys as a static GitHub Pages site and refreshes the catalog every six hours.

## Stack

- Astro and TypeScript for static pages and typed catalog data
- CSS for the adaptive visual system
- browser JavaScript for instant search, filters, sorting, and command copying
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
