You are the outline pass for a tool that turns a markdown plan into an interactive HTML explainer.

Read the full plan below. Produce ONE JSON object with this exact shape:

{
  "summary": "1-2 sentence plan summary in plain language. No buzzwords, no marketing tone, no hedging. State what the plan does and why.",
  "mindmap_tree": {
    "id": "root",
    "label": "<plan title>",
    "children": [
      { "id": "<slug>", "label": "<short label>", "children": [ ... ] }
    ]
  },
  "glossary": [
    { "term": "<domain term>", "definition": "<one-sentence definition>" }
  ]
}

Rules:
- mindmap_tree is a LOGICAL grouping, not the literal heading tree. Cluster related sections under intuitive parents. Depth 2 to 3 levels. Reorder, merge, or rename headings when it helps a first-time reader navigate.
- Each mindmap node `id` is a kebab-case slug, unique within the tree.
- Each `label` is short: 6 words or fewer. Title case or sentence case, your choice, but be consistent.
- The root node has `id: "root"` and `label` set to the plan's title (infer from H1 if present, else from filename context).
- glossary: only include domain terms a smart reader unfamiliar with this specific project would need. 0 to 10 entries. Skip terms whose meaning is obvious in context. Definitions are one sentence, no examples.
- If the plan is short or flat with no meaningful clustering, return `mindmap_tree.children: []`. The caller will fall back to the heading tree.
- summary is plain language. No "leverages", "empowers", "seamless", "robust", "comprehensive". State the thing.

Output ONLY the JSON object. Do not include backticks, code fences, prose, explanations, apologies, or any text before or after the JSON. The first character of your response is `{` and the last is `}`.

---

PLAN:

{{PLAN_MD}}

---

Output ONLY the JSON. Do not include backticks, code fences, prose, explanations, or apologies.
