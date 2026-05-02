# JSON Contracts — primer

Loaded on demand by the agent. Defines the exact shapes returned by `assets/prompts/outline.md` and `assets/prompts/enrich.md`, the parse-failure recovery rules, the chunking strategy for oversized sections, and the concurrency budget.

---

## 1. Pass 1 — Outline (`outline.md`)

### TypeScript shape

```ts
type Outline = {
  summary: string;                 // 1–2 sentences, plain prose
  mindmap_tree: MindmapNode;       // root has id "root"
  glossary: Array<{ term: string; definition: string }>;
};

type MindmapNode = {
  id: string;                      // kebab-case slug, unique within tree
  label: string;                   // ≤6 words
  children?: MindmapNode[];        // depth 2–3 logical levels
};
```

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["summary", "mindmap_tree", "glossary"],
  "additionalProperties": false,
  "properties": {
    "summary": { "type": "string" },
    "mindmap_tree": { "$ref": "#/$defs/node" },
    "glossary": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "object",
        "required": ["term", "definition"],
        "additionalProperties": false,
        "properties": {
          "term": { "type": "string" },
          "definition": { "type": "string" }
        }
      }
    }
  },
  "$defs": {
    "node": {
      "type": "object",
      "required": ["id", "label"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
        "label": { "type": "string" },
        "children": {
          "type": "array",
          "items": { "$ref": "#/$defs/node" }
        }
      }
    }
  }
}
```

### Validation notes

- `mindmap_tree.id` must equal `"root"`.
- `mindmap_tree.children` may be `[]` (small/flat plan).
- All `id` values must be unique across the tree.

---

## 2. Pass 2 — Enrich (`enrich.md`)

### TypeScript shape

```ts
type Enrichment = {
  tldr: string;                    // 1–2 sentences, no markdown
  eli5: string;                    // plain language, ≤3 short paragraphs
  questions: string[];             // 0–5 items, each ≤120 chars
  diagram?: {
    kind: "mermaid";
    code: string;                  // valid mermaid 10.9
    inferred: true;                // always true from the LLM; caller may flip to false
  };
};
```

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["tldr", "eli5", "questions"],
  "additionalProperties": false,
  "properties": {
    "tldr": { "type": "string" },
    "eli5": { "type": "string" },
    "questions": {
      "type": "array",
      "maxItems": 5,
      "items": { "type": "string", "maxLength": 120 }
    },
    "diagram": {
      "type": "object",
      "required": ["kind", "code", "inferred"],
      "additionalProperties": false,
      "properties": {
        "kind": { "const": "mermaid" },
        "code": { "type": "string" },
        "inferred": { "type": "boolean" }
      }
    }
  }
}
```

### Validation notes

- Allowed mermaid diagram types: `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `journey`, `gantt`, `gitGraph`.
- Reject diagrams with > 25 nodes — drop the `diagram` field and log a warning, do not fail the section.
- If the section already contains a fenced ```mermaid block authored by the writer, keep that block and set `inferred: false` on it. The LLM-produced diagram is appended only when no author diagram exists.

---

## 3. Parse-failure handling

LLMs sometimes wrap JSON in code fences, prefix it with "Here is the JSON:", or append apologies. Handle this defensively before calling `JSON.parse`.

### Algorithm (mirrors `~/dev/pico/brief/src/summarize.ts:extractJsonPayload`)

This is a Claude Code skill, not a Deno tool — do not import the function. Reimplement the logic in whatever runtime the agent uses (or do it by hand when reading the LLM response):

1. Trim whitespace.
2. Strip a leading ```` ```json ```` or ```` ``` ```` fence and a trailing ```` ``` ```` fence if present.
3. Split the remaining text by newline.
4. For `start = 0` to `lines.length - 1`: take `lines.slice(start).join("\n").trim()`. If it begins with `{`, attempt `JSON.parse`. Return on first success.
5. If no slice parses, attempt `JSON.parse` on the whole trimmed string (so the original error surfaces).

This recovers from common drift like:

- Leading prose: `Here is the JSON:\n{...}` → step 4 finds the `{` line and parses from there.
- Trailing prose: `{...}\nHope this helps!` → step 4 still parses on the first attempt; the parser stops at matching `}`. If the LLM emitted prose before a closing brace, step 5 surfaces a clean error.
- Code fences: stripped in step 2.

### Retry rule

On parse or schema-validation failure: send ONE retry with the same input plus an appended reminder:

```
Your previous response was not valid JSON. Return ONLY the JSON object specified in the prompt. Do not include backticks, fences, prose, or explanations. The first character must be `{` and the last must be `}`.
```

If the retry also fails, fall back gracefully (next section).

### Fallback shapes

Outline failure (after 1 retry):

```json
{
  "summary": "",
  "mindmap_tree": { "id": "root", "label": "<plan title>", "children": [] },
  "glossary": []
}
```

The caller then derives the mindmap from the heading tree (and falls through to a flat TOC if heading depth ≤ 1).

Enrich failure (after 1 retry, per section):

```json
{
  "tldr": null,
  "eli5": null,
  "questions": [],
  "error": "enrichment failed"
}
```

The UI renders the section with raw body only; the TL;DR row is omitted and the section pill shows a small warning marker.

---

## 4. Long-section chunking

Sections > ~8K tokens (~32K chars as a cheap proxy) get split before enrichment. Run-of-summaries pattern, adapted from `~/dev/pico/brief/src/chunk.ts`:

1. Split the section body on **paragraph boundaries** — a paragraph break is two-or-more consecutive newlines (`/\n\s*\n/`). Never split mid-paragraph; never split inside a fenced code block.
2. Greedily pack paragraphs into chunks, each ≤ ~6K tokens, with ~200 tokens of overlap (carry the last paragraph of chunk N as the first paragraph of chunk N+1).
3. Run the enrich prompt on each chunk independently. Collect the per-chunk `tldr` strings.
4. Concatenate all chunk `tldr`s with `\n\n`. Run the enrich prompt ONCE more, treating the concatenation as `SECTION_MD`. The result is the section's final enrichment.
5. If the section had author-supplied mermaid blocks, preserve them verbatim and skip diagram inference for the chunked path (too easy to hallucinate a diagram from a partial view).

Edge case: if step 1 produces a single paragraph that is itself > 8K tokens (huge code block, giant table), do not chunk. Run enrich on the whole section, accept the cost, and let the model summarize.

---

## 5. Concurrency

Hard cap: **≤ 4 parallel enrichment calls** in flight at any time. Use a simple semaphore / pool. Outline pass is always sequential (one call total).

Rationale: respects rate limits across providers, keeps token-per-second bounded, and avoids overwhelming the local agent's transport.

---

## 6. Worked example

### Input plan (`example-plan.md`)

```markdown
# Webhook retry queue

## Problem
Our payment webhooks fail silently when the downstream merchant API is slow.
We retry zero times. Lost events show up as missing reconciliations a day later.

## Approach
Persist every inbound webhook to a `webhook_event` table immediately. A worker
polls pending rows and POSTs them to the merchant. On 5xx or timeout, increment
`attempts` and reschedule with exponential backoff (1m, 5m, 30m, 2h, 12h).
After 5 attempts the row is marked `dead` and an alert fires.

## Rollout
Ship behind a per-merchant feature flag. Backfill the last 7 days of webhook
logs into the new table on first enable so retries can pick up genuine
in-flight failures from the legacy path.
```

### Pass-1 outline JSON

```json
{
  "summary": "Add a durable retry queue for payment webhooks so transient downstream failures stop turning into lost reconciliations.",
  "mindmap_tree": {
    "id": "root",
    "label": "Webhook retry queue",
    "children": [
      {
        "id": "motivation",
        "label": "Why we need it",
        "children": [
          { "id": "silent-failures", "label": "Silent webhook drops" }
        ]
      },
      {
        "id": "design",
        "label": "How it works",
        "children": [
          { "id": "persistence", "label": "Persist every event" },
          { "id": "retry-policy", "label": "Backoff and dead-letter" }
        ]
      },
      {
        "id": "rollout",
        "label": "Rollout plan",
        "children": [
          { "id": "feature-flag", "label": "Per-merchant flag" },
          { "id": "backfill", "label": "7-day backfill" }
        ]
      }
    ]
  },
  "glossary": [
    { "term": "Reconciliation", "definition": "The daily process of matching merchant ledger entries against expected payment events." },
    { "term": "Dead-letter", "definition": "A terminal state for an event that has exhausted all retries and requires human review." }
  ]
}
```

### Pass-2 enrich JSON — `## Problem`

```json
{
  "tldr": "Payment webhooks currently fail silently when the merchant API is slow, and the missing events only surface a day later during reconciliation.",
  "eli5": "When we tell a merchant about a payment, we send them a webhook. If their server is slow or down, our message disappears and we never try again.\n\nNobody notices until the next day, when the books don't balance.",
  "questions": [
    "How many webhooks are we currently losing per day?",
    "Are losses concentrated on specific merchants or spread evenly?"
  ]
}
```

### Pass-2 enrich JSON — `## Approach`

```json
{
  "tldr": "Save every inbound webhook to a database table, then have a worker retry delivery with exponential backoff up to five times before dead-lettering and alerting.",
  "eli5": "Instead of trying to deliver a webhook once and forgetting it, we write it down first. A background worker reads the list and tries to deliver each one.\n\nIf delivery fails, we wait a bit and try again. The waits get longer each time: one minute, five, thirty, two hours, twelve hours.\n\nAfter five failures we give up on that event, mark it as dead, and page someone.",
  "questions": [
    "What happens if the worker itself crashes mid-retry?",
    "Is the backoff schedule per-event or per-merchant?",
    "How do we prevent a single bad merchant from saturating the worker?"
  ],
  "diagram": {
    "kind": "mermaid",
    "code": "stateDiagram-v2\n  [*] --> pending: webhook received\n  pending --> delivering: worker picks up\n  delivering --> done: 2xx\n  delivering --> pending: 5xx, attempts < 5\n  delivering --> dead: attempts == 5\n  done --> [*]\n  dead --> [*]: alert fires",
    "inferred": true
  }
}
```

### Pass-2 enrich JSON — `## Rollout`

```json
{
  "tldr": "Roll out behind a per-merchant feature flag and backfill the last seven days of webhook logs on first enable so in-flight failures from the old path get picked up.",
  "eli5": "We turn the new system on for one merchant at a time using a switch. The first time we flip the switch for a merchant, we copy their last week of webhook history into the new table so any messages that were stuck in the old path can be retried.",
  "questions": [
    "What's the criterion for promoting a merchant from flagged to default?",
    "Could the backfill double-deliver events that the legacy path eventually retried?"
  ]
}
```

Notes the worked example illustrates:

- Logical grouping ≠ heading tree: the outline introduced a `motivation` parent that the source markdown didn't name.
- Glossary skipped obvious terms (webhook, backoff) and kept domain ones (reconciliation, dead-letter).
- Diagram appeared on the section that benefited from one (state machine for retry lifecycle), not on prose-only sections.
- All three section enrichments stayed aligned with the plan-level summary without echoing it.
