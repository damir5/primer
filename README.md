# primer

Claude Code skill that turns a markdown plan, PRD, RFC, or architecture doc into a single self-contained interactive HTML explainer.

## What you get

- Progressive disclosure: TL;DR-first list, expand to read the original section, ELI5, questions, or diagram.
- Mindmap navigation built from an LLM-derived logical grouping (falls back to heading tree, then flat TOC).
- Per-section AI enrichment: TL;DR, ELI5, questions, optional inferred mermaid diagram (badged in the SVG itself).
- Light + dark theme, with manual toggle and `prefers-color-scheme` baseline.
- Print mode via `?print=1` — expands all sections, hides nav, waits for diagrams to render.
- Single HTML output. CSS and JS inlined. Vendor libs from CDN.
- Cached enrichment in `<input>.primer.cache.json`. Re-runs make zero LLM calls when content is unchanged.
- Author overrides via HTML comments when the LLM is wrong.

## Install

```bash
git clone https://github.com/USER/primer.git ~/dev/pico/primer
ln -sfn ~/dev/pico/primer ~/.claude/skills/primer
```

Replace `USER` with the actual fork. Update with `git pull` inside `~/dev/pico/primer`.

## Use

From inside Claude Code, point the agent at a markdown file:

> build a primer for `~/docs/my-plan.md`

Or open the file and say "make this readable" / "render this plan as HTML". The skill description matches those phrasings.

After the run, two files appear next to the source:

```
my-plan.md
my-plan.html                # open in any browser
my-plan.primer.cache.json   # enrichment cache; keep across runs
```

## How it works

The agent reads `SKILL.md` and follows the recipe end-to-end. Pass 1 sends the whole markdown to the LLM and gets back an outline (summary, mindmap tree, glossary). Pass 2 enriches each section in parallel (max 4 concurrent) using the outline as shared context. Both passes are cached by content hash, keyed jointly so a plan-context change re-enriches affected sections only. Render substitutes the section data, mindmap, and glossary into `template.html` and inlines `styles.css` and `app.js`. There is no CLI, no Deno runtime, no API key handling — the agent is the runtime.

## Cost

First run on Sonnet 4.6: ~5K input tokens for the outline pass plus ~800 tokens per section for enrichment (~500 in, ~300 out). On a 30-section plan that totals roughly $0.03 (outline) + $0.20 (enrichment) ≈ **$0.25/plan**. Cached re-runs hit zero LLM calls and cost ~$0. Hard cap at 100 sections — above that the skill refuses without calling the LLM.

## Caveats

- **CDN required at view time.** Alpine, mermaid, markmap, panzoom, and markdown-it load from jsdelivr. The output HTML needs internet to render. For offline-shareable output, post-process with `monolith` (out of scope here).
- **Author overrides** via HTML comments in the source markdown:
  - `<!-- primer:tldr "one-line summary" -->`
  - `<!-- primer:eli5 "plain-language explanation" -->`
  - `<!-- primer:skip-diagram -->`

  Overrides win over LLM output and are not re-prompted.
- **AI-inferred diagrams are badged** by drawing the badge into the mermaid SVG, so the marker survives screenshot crops.
- **V1 is learn-mode only.** Pitch mode is deferred — learn and pitch have different data shapes and don't belong in one binary yet.

## Layout

```
~/dev/pico/primer/                  # git repo
├── SKILL.md                        # agent-facing recipe
├── README.md                       # this file
├── template.html                   # output template with {{SLOTS}}
├── styles.css                      # light + dark + print theme
├── app.js                          # Alpine components, navigation, persistence
├── assets/
│   └── prompts/
│       ├── outline.md              # pass-1 prompt
│       └── enrich.md               # pass-2 prompt
├── references/
│   └── json-contracts.md           # JSON schemas + parse fallbacks
└── examples/
    ├── plan.md                     # canonical input
    └── plan.html                   # committed reference output
```

Symlinked into `~/.claude/skills/primer` for Claude Code discovery.

## Reference example

Open `examples/plan.html` in a browser to preview the output shape:

```bash
open ~/dev/pico/primer/examples/plan.html
```

The matching source `examples/plan.md` is the canonical input the skill is calibrated against.

## License

MIT.
