#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

python3 -m unittest discover -s tests -p 'test_*.py'
npm run check
npm run build

model_count="$(node -e "const data=require('./src/data/models.json'); console.log(data.models.length)")"
if [[ "$model_count" -lt 150 ]]; then
  echo "Expected at least 150 catalog entries, found $model_count" >&2
  exit 1
fi

echo "Verified Astro build with $model_count official Ollama models."
