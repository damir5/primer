---
name: primer
description: Use when the user wants to turn a markdown plan, PRD, RFC, or architecture doc into an interactive HTML explainer with progressive disclosure, mindmap navigation, and AI-enriched section summaries. Invoke on any path ending in .md when the user asks to "make this readable", "build a primer", "render this plan as HTML", "create a learning doc", or "give me an explainer".
---

# primer

Turn one markdown file into one self-contained interactive HTML explainer. Two LLM passes (whole-plan outline + per-section enrichment), cached, deterministic.

## Inputs

- `<input>.md` — single markdown file. Required.
- `--split-on H1|H2|H3` — optional split level. Default: `H2`. Fallback: if the doc has no `H2`, use `H1`. Never split below `H3`.

## Outputs

Written next to the source:

- `<input>.html` — single self-contained file (CSS + JS inlined; vendor libs from CDN).
- `<input>.primer.cache.json` — enrichment cache. Keep across runs.

## Steps

Execute exactly. No improvisation.

### 1. Read and split

Read `<input>.md`. Pick split heading level per `--split-on` rules above. Slice the body into sections at that heading level. Content above the first split heading becomes the intro section (id `intro`, level = 1).

Build initial section records: `{id, title, level, bodyMd}`.

- `id` — kebab-case slug from `title`, deduplicated by appending `-2`, `-3`, ... if a slug repeats.
- `title` — heading text *without* the leading `#`/`##` markers.
- `level` — number of `#` chars in the heading line.
- `bodyMd` — section content **excluding** the heading line. Starts at the first non-heading line; ends just before the next same-or-higher heading. Trim leading/trailing blank lines.

If section count > 100: stop. Print `primer: refusing — N sections exceeds 100-section cap` and exit. Do not call the LLM.

If section count > 100: stop. Print `primer: refusing — N sections exceeds 100-section cap` and exit. Do not call the LLM.

### 2. Extract author overrides

Scan each section's `bodyMd` for HTML comment overrides. Match only when the comment is on its own line (no leading or trailing non-whitespace), so `<!-- primer:tldr "..." -->` literals appearing inside inline-code spans or table cells are treated as prose, not overrides.

- `<!-- primer:tldr "..." -->` → set `overrides.tldr = "..."`
- `<!-- primer:eli5 "..." -->` → set `overrides.eli5 = "..."`
- `<!-- primer:skip-diagram -->` → set `overrides.skipDiagram = true`

Strip the matched comment lines from `bodyMd` before chunking and hashing. Remember the override values per section for step 9.

Also note: if a section's stripped body contains a fenced ```mermaid block, mark `hasAuthorDiagram = true` for that section.

### 3. Hash

Normalization function, applied in this order:

1. Strip a leading UTF-8 BOM (`﻿`) if present.
2. Convert all line endings to LF: replace `\r\n` and bare `\r` with `\n`.
3. Trim trailing whitespace from each line.
4. Collapse runs of two-or-more blank lines into a single blank line.

Hash inputs (both must be the override-stripped form from step 2):

- `plan_hash = sha256(normalize(full_md_after_override_strip))` — the entire document with override comments removed.
- For each section: `section_hash[i] = sha256(normalize(section.bodyMd))` — bodyMd only, no heading line, override comments already removed.

### 4. Load cache

Read `<input>.primer.cache.json` if it exists. Parse as JSON. On parse error or missing file:

```
cache = { outline: null, sections: {} }
```

### 5. Pass 1 — outline (single call)

Trigger: `cache.outline == null` OR `cache.outline.plan_hash != plan_hash`.

If triggered:

1. Read `assets/prompts/outline.md`.
2. Send: prompt body + the full normalized markdown.
3. Parse response using the JSON-extract algorithm in `references/json-contracts.md` (strip code fences, scan for first valid JSON object).
4. Validate against the outline schema in `references/json-contracts.md`.
5. On parse OR schema failure: retry once with the appended reminder `Return ONLY valid JSON, no prose, no backticks.`
6. On second failure: fall back to
   ```
   { summary: "", mindmap_tree: heading_tree(md), glossary: [] }
   ```
   where `heading_tree` builds a nested tree from the doc's heading hierarchy. Continue.
7. Store: `cache.outline = { plan_hash, summary, mindmap_tree, glossary }`.

If not triggered: reuse `cache.outline`.

### 6. Outline hash

Hash only the *semantic* outline content — `summary`, `mindmap_tree`, `glossary` — **not** the cache-management `plan_hash` field:

```
outline_hash = sha256(stableStringify({
  summary: cache.outline.summary,
  mindmap_tree: cache.outline.mindmap_tree,
  glossary: cache.outline.glossary,
}))
```

Where `stableStringify` serializes with sorted object keys so the result is deterministic across runs and across agents.

Excluding `plan_hash` from the hash means an outline that the LLM regenerates to identical content (because the user only fixed a typo) yields the same `outline_hash` — so per-section cache keys remain valid and only sections with content changes re-enrich.

### 7. Pass 2 — enrichment (parallel, max 4 concurrent)

For each section, compute `key = section_hash + "|" + outline_hash`.

If `cache.sections[key]` exists: reuse it.

Otherwise:

1. Read `assets/prompts/enrich.md`.
2. Send: prompt body + `cache.outline.summary` + section title + section `bodyMd`.
3. Parse and validate against the enrich schema in `references/json-contracts.md`.
4. On parse/schema failure: retry once with the JSON-only reminder.
5. On second failure: store
   ```
   { tldr: null, eli5: null, questions: [], diagrams: [], error: "enrichment failed" }
   ```
   so the UI degrades gracefully.
6. Store result at `cache.sections[key]`.

Cap concurrency at 4 in-flight calls. No exceptions. If your runtime lacks a semaphore primitive, the simplest acceptable pattern is fixed-size batches: process the section list in groups of 4 and start the next group only after all calls in the current group complete.

### 8. Long-section chunking

If a section's input exceeds 8K tokens (estimate: `chars / 4`), use the chunking algorithm in `references/json-contracts.md §4` — that document is the authority for chunk size, overlap, paragraph-boundary rules, and edge cases. Summary:

1. Split `bodyMd` on paragraph boundaries; never split inside a fenced code block.
2. Greedily pack into chunks of ≤ 6K tokens each, with the last paragraph of chunk N carried into chunk N+1 as overlap.
3. Run enrich.md on each chunk; collect the per-chunk `tldr`s.
4. Run enrich.md once more on the joined `tldr`s as `bodyMd` (summary-of-summaries) — that is the section's final enrichment.
5. If a single paragraph itself exceeds 8K tokens (huge code block, giant table), do **not** chunk: run enrich on the whole section once and accept the cost.

Per-chunk results are not cached separately. Only the final merged section result is cached at `key`.

### 9. Merge author overrides

For each section, build the final record by overlaying overrides on cache results:

- If `overrides.tldr` is set: `tldr = overrides.tldr`, `fromOverride.tldr = true`.
- If `overrides.eli5` is set: `eli5 = overrides.eli5`, `fromOverride.eli5 = true`.
- If `overrides.skipDiagram` is set: `diagrams = []`, `fromOverride.skipDiagram = true`.
- For any diagram surviving the merge: if the section had `hasAuthorDiagram`, set `inferred = false`. Otherwise the LLM produced it: `inferred = true`.

Override always wins over cache. Do not call the LLM again to honor an override.

### 10. Render

1. Read `template.html`, `styles.css`, `app.js` from the skill directory.
2. **Pre-substitute `{{INPUT_HASH16}}` inside `app.js` content before inlining.** `app.js` uses `{{INPUT_HASH16}}` to derive the per-plan `localStorage` key; substitute it in the source string first, otherwise the next step's single-pass regex on the template will not visit the inlined content. Likewise, pre-substitute any other slot whose value lives inside `app.js` or `styles.css` rather than the template.
3. Build the template-level substitutions:
   - `{{TITLE}}` — text of the first `# ` heading in the markdown (without the `# ` prefix), or filename without extension if no H1 exists. HTML-escape `<`, `>`, `&` for safe insertion into `<title>` and `<h1>`.
   - `{{STYLES_INLINE}}` — `<style>` + contents of `styles.css` + `</style>`.
   - `{{APP_JS_INLINE}}` — `<script>` + INPUT_HASH16-pre-substituted `app.js` + `</script>`.
   - `{{SECTIONS_JSON}}` — JSON array of finalized section records (see `references/json-contracts.md` Section type). Escape `</script` to `<\/script` to prevent early closure of the embedding `<script type="application/json">` block.
   - `{{MINDMAP_JSON}}` — same escaping rule applied to `cache.outline.mindmap_tree`.
   - `{{GLOSSARY_JSON}}` — same escaping rule applied to `cache.outline.glossary`.
   - `{{GENERATED_AT}}` — current ISO 8601 UTC timestamp.
   - `{{INPUT_HASH16}}` — first 16 hex chars of `plan_hash` (also already used in step 2 above).
4. Substitute every placeholder in a single pass over the template. Do not chain `.replace` calls — embedded JSON or section bodies may legitimately contain `{{TITLE}}`, `{{SECTIONS_JSON}}` and similar literals as documentation, and a chained pass would re-substitute them. Use one regex pass with a placeholder→value lookup so already-substituted content is never revisited. Write `<input>.html`.
5. Write the updated cache atomically: write to `<input>.primer.cache.json.tmp`, then rename to `<input>.primer.cache.json`.

## Constraints

DO:

- Use the JSON-extract algorithm from `references/json-contracts.md` for every LLM response parse.
- Write the cache atomically (`.tmp` + rename) so a crash mid-write cannot corrupt it.
- Cap enrichment concurrency at 4.
- Mark every LLM-inferred diagram with `inferred: true` in the section record.

DO NOT:

- Modify `template.html`, `styles.css`, `app.js`, `assets/prompts/*`, or `references/*` at runtime. They are static skill assets.
- Skip caching. Re-runs on unchanged input must make zero LLM calls.
- Exceed 4 concurrent enrichment calls.
- Inline an AI-inferred diagram without setting `inferred: true`.
- Process plans with more than 100 sections. Fail loudly per step 1.
- Escape or pre-render the user's markdown into HTML inside the agent. Markdown rendering happens client-side via markdown-it; pass `bodyMd` through verbatim.

## Examples

Canonical reference run: `examples/plan.md` → `examples/plan.html`. Inspect both to see the expected output shape and section data model.
