# Vango GPT Image 2 Prompt Mirror

This repository stores the prompt gallery data and mirrored preview images used by Vango / HappyHorse.

## Contents

- `data/gpt-image-2-prompts.json` - the prompt dataset consumed by the site.
- `images/prompts/` - mirrored preview images referenced by the dataset.
- `SOURCE.md` - upstream source and attribution notes.
- `LICENSE` - upstream MIT license retained from the original repository snapshot.

## Site Usage

The Vango site can read the JSON from:

`https://raw.githubusercontent.com/JeremyGDM/Vango-gpt-image2-prompt/main/data/gpt-image-2-prompts.json`

Each prompt image points at this same repository under `images/prompts/`, so if the original external CDN changes or deletes files, the site can continue rendering from this mirror.

## Update Flow

1. Update `data/gpt-image-2-prompts.json`.
2. Add any new preview images under `images/prompts/`.
3. Commit and push to GitHub.
4. Sync the Vango site JSON in `NanoBananPro/public/static/gpt-image-2-prompts.json` if the site should use the new snapshot.

See `SOURCE.md` for upstream attribution.
