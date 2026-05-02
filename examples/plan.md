# Plan: `primer` — interactive plan/doc explainer

## Context

User wants a tool that ingests a markdown plan (PRD, RFC, architecture doc, pitch) and produces a single shareable, interactive HTML page that helps a reader understand it: progressive disclosure (TL;DR-first), an LLM-generated logical mindmap as navigation, mermaid diagrams (author-supplied or AI-inferred-and-badged), responsive layout (mobile/tablet/desktop), Linear-inspired light theme with dark mode.

Existing tools were investigated and rejected (LiaScript, Quarto+Closeread, Slidev, NotebookLM, Gamma) — none match the dual learn-first / future-pitch shape with auto-generated mindmap and the agent-driven LLM constraint.

The tool is **agent-driven**: it ships as a Claude Code skill that any agent (Claude Code primarily; Codex / Gemini CLI via recipe) can execute. **No Deno, no `~/bin`, no CLI binary, no API keys handled by the tool.** The agent IS the runtime.

Distribution = `git clone <repo> ~/.claude/skills/primer`. Updates = `git pull`.

V1 is **learn-mode only**. Pitch mode is deferred — Codex's collab2 finding (learn ≠ pitch as data shapes) and the consistent flaw the self-critiques surfaced: "two products fighting in one binary".

---

## Repo / install layout

```
~/.claude/skills/primer/                  # the entire product
├── SKILL.md                              # YAML frontmatter + prescriptive recipe
├── README.md                             # human-facing: install, cost, caveats
├── template.html                         # static template with {{SLOTS}}
├── styles.css                            # Linear-inspired theme; light + dark + print
├── app.js                                # Alpine components, navigation, persistence, keyboard
├── assets/
│   └── prompts/
│       ├── outline.md                    # pass-1 prompt (whole-plan context + mindmap tree + glossary)
│       └── enrich.md                     # pass-2 prompt (per-section TL;DR / ELI5 / Q / inferred-diagram)
├── references/
│   └── json-contracts.md                 # exact JSON schemas; parse-failure fallbacks
└── examples/
    ├── plan.md                           # sample input
    └── plan.html                         # committed reference output
```

Naming follows the local skill convention from the Phase-1 survey (`assets/`, `references/`, frontmatter required).

---

## SKILL.md shape

```yaml
---
name: primer
description: Use when the user wants to turn a markdown plan, PRD, RFC, or architecture doc into an interactive HTML explainer with progressive disclosure, mindmap navigation, and AI-enriched section summaries. Invoke on any path ending in .md when the user asks to "make this readable", "build a primer", "render this plan as HTML", "create a learning doc", or "give me an explainer".
---
```

Body of SKILL.md is **prescriptive** (no improvisation):

1. **Inputs** — `<input>.md`
2. **Outputs** — `<input>.html` and `<input>.primer.cache.json` next to source
3. **Steps** — numbered, with exact filenames + hash specs:
   1. Read MD; split by `--split-on` (default H2; fallback H1 if no H2; never below H3)
   2. Scan body for `<!-- primer:tldr "..." -->`, `<!-- primer:eli5 "..." -->`, `<!-- primer:skip-diagram -->` overrides
   3. Compute `plan_hash = sha256(full_md_normalized)` and `section_hash[i] = sha256(section_content_normalized)`
   4. Load `<input>.primer.cache.json` if exists
   5. **Pass 1**: if `cache.outline.plan_hash != plan_hash`, prompt with `assets/prompts/outline.md` + full MD → JSON `{summary, mindmap_tree, glossary[]}`. Validate against schema. On parse-fail: retry once with explicit "return only JSON" reminder; then fall back to heading-tree mindmap and empty summary.
   6. **Pass 2**: parallel ≤4 concurrent calls. Per cache-miss section (key = `section_hash + outline_hash`): prompt with `assets/prompts/enrich.md` + outline.summary + section content → JSON `{tldr, eli5, questions[], diagram?}`. On parse-fail: retry once; then store `{tldr: null, error: "enrichment failed"}` and continue (UI shows section without TL;DR).
   7. Sections >8K tokens: split at paragraph boundaries, summarize parts, then summarize-of-summaries.
   8. Merge author overrides field-by-field (override wins).
   9. Render: read `template.html`, inline `styles.css` and `app.js` as `<style>`/`<script>`, substitute `{{TITLE}}`, `{{SECTIONS_JSON}}`, `{{MINDMAP_JSON}}`, `{{GLOSSARY_JSON}}`, `{{GENERATED_AT}}`.
   10. Write `<input>.html` and updated cache file.
4. **Constraints** — DO NOT modify `template.html`, `styles.css`, `app.js`, or any vendor reference. DO NOT skip caching. DO NOT exceed 4 concurrent enrichment calls. DO NOT inline AI-inferred diagrams without `inferred: true` flag.
5. **Examples** — link to `examples/plan.md` → `examples/plan.html`.

Detailed JSON schemas live in `references/json-contracts.md` (loaded into agent context only when needed).

---

## Section data model (rendered as embedded JSON)

```ts
type Section = {
  id: string;                    // slug from title
  title: string;
  level: 1|2|3;
  bodyMd: string;                // raw MD; rendered client-side via markdown-it CDN
  tldr: string | null;
  eli5: string | null;
  questions: string[];
  diagrams: Array<{
    kind: "mermaid";             // markmap kept for nav only; section diagrams = mermaid
    code: string;
    inferred: boolean;
  }>;
  fromOverride: { tldr?: true; eli5?: true; skipDiagram?: true };
};

type Outline = {
  summary: string;
  mindmap_tree: { id: string; label: string; children: MindmapNode[] };
  glossary: Array<{ term: string; definition: string }>;
};
```

`{{SECTIONS_JSON}}` and `{{MINDMAP_JSON}}` are embedded as `<script type="application/json" id="...">` blocks; Alpine reads on init.

**Markdown rendering**: client-side via markdown-it from CDN. Agent's job is enrichment, not parsing — stays out of HTML escaping / code-block / table edge cases.

---

## CDN dependencies (pinned to minor)

In `template.html` `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14/dist/cdn.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9/dist/mermaid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18"></script>
<script src="https://cdn.jsdelivr.net/npm/panzoom@9.4/dist/panzoom.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js"></script>
```

Tradeoff documented in README: requires internet at view time. If user needs offline-shareable output, they can run a one-shot `monolith` post-processor — out of scope for v1.

---

## UI behavior

ASCII layout (desktop ≥1024px):
```
┌─────────────────────────────────────────────────────────────────┐
│ Title                              [☼/☾]  [🖨 print]  [search] │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│  mindmap     │   §1 Title                                       │
│  (markmap)   │   ──────────                                     │
│              │   TL;DR italic — 1–2 lines                       │
│  ▸ A         │   [Original] [ELI5] [Questions] [Diagram]        │
│    ▸ A.1     │   ↓ expanded body (markdown-rendered)            │
│    ▸ A.2     │                                                  │
│  ▸ B         │   §2 Title                                       │
│  ▸ C         │   ──────────                                     │
│              │   TL;DR italic — 1–2 lines                       │
│              │   [Original] [ELI5] [Questions] [Diagram]        │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

- **Tablet (640–1023px)**: mindmap collapses to drawer, hamburger toggle.
- **Mobile (<640px)**: mindmap is full-screen home; tap node → section view; back returns to mindmap.

**Default view = TL;DR-first list** (each section row shows heading + TL;DR + tab-availability dots). Click row = expand inline + tab strip appears.

**Tabs**: `Original | ELI5 | Questions | Diagram`. Keyboard `1`–`4` switches, `j/k` next/prev section, `/` focus search, `esc` close diagram zoom, `d` toggle dark mode.

**Mindmap source** — fallback chain:
1. LLM `outline.mindmap_tree` if pass-1 succeeded and validates
2. Heading hierarchy from MD if pass-1 failed
3. Flat TOC list if heading depth ≤ 1

**AI-inferred diagram badge**: rendered into the mermaid SVG itself (top-right corner, `<text>` element) so it survives screenshots — not just a `<div>` above the diagram.

**Diagram zoom**: click → modal with panzoom. Pinch-zoom on mobile.

**Persistence**: `localStorage[primer:<sha256(input_md).slice(0,16)>]` stores `{darkMode, expandedSections[], lastSection}`. Keyed by content hash so the same plan moved between paths keeps state.

**Print mode**: `?print=1` URL — expands all sections, hides nav, awaits all `mermaid.run()` promises before paint. Document this in README; native `Cmd-P` is best-effort.

**Glossary**: rendered as a dedicated section at the bottom (no hover-tooltips in v1 — false-positive risk in code/links isn't worth it).

**Dark mode**: `@media (prefers-color-scheme: dark)` baseline + manual toggle button persisted in localStorage.

**Accessibility baseline**:
- Native `<details>` / `<summary>` for collapsibles (free a11y)
- Semantic `<nav>` / `<main>` / `<article>`
- Focus management on tab swap
- Mode/dark-mode toggles keyboard-accessible
- Mindmap has TOC list fallback when JS off

---

## Theme tokens (Linear-inspired)

Light:
```
--bg:#fafafa; --bg-elev:#fff; --fg:#0a0a0a; --fg-muted:#5a5a5a;
--accent:#5e6ad2; --accent-soft:#eef0fb;
--border:#ececec; --shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.04);
--radius:8px;
--mono:"JetBrains Mono",ui-monospace,monospace;
--sans:"Inter",-apple-system,system-ui,sans-serif;
```

Dark (toggled via `prefers-color-scheme` or `.dark` on `<body>`):
```
--bg:#0e0f12; --bg-elev:#16181d; --fg:#e8e8ea; --fg-muted:#8a8e96;
--accent:#7a82e8; --accent-soft:#1c1f33; --border:#23252c;
```

Typography: Inter 16/1.6, max-width 68ch; headings 600 weight, tight tracking; TL;DR italic with accent left-border; inline code soft-bg pill in JetBrains Mono 14px; links underline-on-hover only.

---

## Cost / scale (documented in README)

- Pass 1: one LLM call per plan. ~5K input + ~1K output. Sonnet 4.6 ≈ $0.03.
- Pass 2: one call per section. ~500 input + ~300 output. 30 sections ≈ $0.20.
- Total first run: **~$0.25/plan** (Sonnet 4.6). Re-runs hit cache → ~$0.
- Token budget: cap at 100 sections per plan (fail loudly above that).

---

## Build phases — with completion criteria

| # | Phase | Done means |
|---|-------|------------|
| 1 | Template + theme + Alpine wiring (no LLM) | Hand-written `examples/plan.html` renders correctly across desktop/tablet/mobile breakpoints; dark mode toggles; tabs work; `<details>` collapsibles work; markmap nav clicks scroll to sections |
| 2 | Prompts + JSON contracts | `outline.md` and `enrich.md` written; manual run via Claude on a real plan produces valid JSON against schemas in `references/json-contracts.md` |
| 3 | SKILL.md recipe | Agent (Claude Code) end-to-end on a real plan from `~/dev/web/fisco/doc/`, no human in loop, valid HTML output, valid cache file |
| 4 | Cache + author overrides + glossary section | Re-run hits cache (no LLM calls); HTML override comments respected; glossary section renders at bottom |
| 5 | Print mode + dark mode + a11y baseline | `?print=1` produces clean print output with diagrams rendered; keyboard nav works; screen reader announces section structure |
| 6 | README + reference example committed | README with install + cost + caveats; `examples/plan.html` committed |

**Phase 7 (deferred / not v1)**: pitch mode. Revisit after one real plan ships and user actually wants it.

---

## Critical files to create

- `~/.claude/skills/primer/SKILL.md` (new — recipe)
- `~/.claude/skills/primer/template.html` (new — single-file output template)
- `~/.claude/skills/primer/styles.css` (new — theme)
- `~/.claude/skills/primer/app.js` (new — Alpine + interactions)
- `~/.claude/skills/primer/assets/prompts/outline.md` (new — pass-1 prompt)
- `~/.claude/skills/primer/assets/prompts/enrich.md` (new — pass-2 prompt)
- `~/.claude/skills/primer/references/json-contracts.md` (new — schemas)
- `~/.claude/skills/primer/examples/plan.md` (new — sample input)
- `~/.claude/skills/primer/examples/plan.html` (new — committed reference output)
- `~/.claude/skills/primer/README.md` (new — human-facing)

The skill dir will live in `~/dev/pico/primer/` as a git repo, symlinked to `~/.claude/skills/primer/` (matches the existing pattern for tools that double as skills, e.g. `ask-human`).

## Patterns to reuse

- **Skill frontmatter + structure**: from local skills convention surveyed in Phase 1 (`name`, `description`, prescriptive body, `assets/` + `references/` subdirs).
- **JSON parse robustness**: copy the strip-fences-then-scan-for-first-valid-object trick from `~/dev/pico/brief/src/summarize.ts:extractJsonPayload` (referenced, not imported — different runtime).
- **Markdown chunking on long sections**: the chunking idea (not the code) from `~/dev/pico/brief/src/chunk.ts`.
- **Section override comments**: same `<!-- name:key "value" -->` shape used elsewhere in the user's tools.

---

## Verification

End-to-end smoke (Phase 3 done):
1. Pick a real plan: `~/dev/web/fisco/doc/fisk2.txt` (or any `.md` in that tree)
2. From Claude Code: invoke the primer skill on that file
3. Open the resulting `.html` in Chrome
4. Check: (a) mindmap renders and nav works; (b) TL;DRs visible by default; (c) expand reveals tabs; (d) at least one mermaid diagram renders (author-supplied or inferred-with-badge); (e) dark-mode toggle works; (f) `?print=1` produces clean print preview; (g) cache file written next to source
5. Resize Chrome to 768px and 375px — verify tablet/mobile behavior
6. Re-run the skill on the same file — confirm zero LLM calls (cache hit)
7. Edit one section's body — re-run — confirm only that one section re-enriched

Lighthouse a11y score ≥ 90 on the reference output (Phase 5 done).

---

## Architectural decisions summary

| Decision | Choice | Why |
|---|---|---|
| Package | Pure Claude Code skill, no Deno binary | Zero-install via `git clone`; matches local skill convention |
| Distribution | `~/dev/pico/primer/` git repo, symlinked into `~/.claude/skills/primer` | Mirrors `ask-human` pattern; reusable across machines |
| Runtime | The agent (Claude/Codex/Gemini) executes the recipe | No subprocess overhead, no shell-injection, no API key handling |
| Vendor JS | CDN-only (jsdelivr), pinned to minor | Tiny output HTML; tradeoff: needs internet at view time |
| LLM passes | 2: outline (whole-plan) + per-section enrichment | Fixes "sections aren't independent" oversight |
| Markdown render | Client-side via markdown-it CDN | Agent stays out of HTML edge cases |
| Mindmap source | LLM logical grouping, with heading-tree and flat-TOC fallbacks | Heading-tree fails on flat plans |
| Section diagrams | Mermaid only (markmap reserved for nav) | Simpler model |
| AI-inferred diagrams | On, badge drawn into SVG itself | Survives screenshot crops |
| Cache | Two-key: `sha256(section)` + `sha256(outline)` | Re-runs cheap; correctly invalidates on plan-context shift |
| Author overrides | `<!-- primer:tldr "..." -->` comments | Escape hatch when LLM is wrong |
| Modes | Learn-only in v1; pitch deferred or cut | Avoids the "two products in one binary" trap |
| Theme | Linear-inspired light + dark + print, Inter + JetBrains Mono | Clean, typography-first |
| Frontend | Vanilla + Alpine.js (CDN) | No build step, declarative |
| A11y | Native `<details>`, semantic landmarks, keyboard, TOC fallback | Cheap to do early |
| Cost target | ~$0.25 first run, ~$0 cached, fail above 100 sections | Predictable + bounded |
