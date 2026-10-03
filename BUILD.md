# BUILD — Producing the self-contained stories.json

This is a ONE-TIME step. After it runs successfully, `data/stories.json` holds every story body plus metadata, and the three Google Docs can be archived/retired.

  ## Inputs

  Three source Google Docs (drafts only, not needed after export):

- COLLECTION: `1RR1qEyAu6a7ly64sNRXNOh_u1gs_IOiqtifFI3CWgyo`
- CONSOLIDATED: `1Bx_8uWSkgvLvTJFrzyNJ6TyBP7qs8cslEB31YilBcmg`
- CONTD: `1njsx8yN5AE5HsBCPcm6hHqvO003squ7jw7j6402ZHuU`

## Step 1 — Export each doc to plain text (once)

In each doc: File > Download > Plain text (.txt). Save as `data/raw/collection.txt`, `data/raw/consolidated.txt`, `data/raw/contd.txt`. Plain-text export is lossless for prose and keeps headings on their own lines, which is what the merge matches against.

## Step 2 — Merge manifest + bodies

The manifests in `data/manifest/*.json` carry every curation decision (dedup, re-categorization, canonical choice). Each canonical record has a `canonical_source` and a `source_anchor` (the exact heading line). For each record with `status: canonical`, open the matching raw text file, find the `source_anchor` heading, and take everything up to the next heading as that record's `body`. Write the combined array to `data/stories.json`.

## Step 3 — Verify & retire

Confirm `data/stories.json` has the expected count (~110-120 stories) and no `body` is empty. Point the app at `data/stories.json`. Once verified, the three Google Docs and `data/raw/` can be archived. A reference Node merge script is kept at `scripts/build.mjs`.
