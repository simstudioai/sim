import { serializeMarkdownDocument } from './markdown-parse'

/**
 * Above this size the file opens read-only. Parsing is chunked and linear now (see
 * {@link serializeMarkdownBody}), so this is no longer about parse cost — it guards ProseMirror's
 * whole-document-in-DOM rendering, which has no virtualization and gets sluggish to edit for very
 * large documents. 256KB sits past the p99 of real markdown files while keeping a giant outlier from
 * mounting thousands of editable DOM nodes.
 */
const PROBE_SIZE_LIMIT = 256 * 1024

/**
 * Constructs the editor drops or mangles in a way that survives a second serialization
 * unchanged — so the idempotency probe below can't see the loss. Each must be matched directly.
 * (Linked images `[![alt](img)](href)` are handled by the image node and verified separately by
 * the link-count check in {@link isRoundTripSafe}, not here.)
 *
 * Footnotes, HTML comments, and raw HTML tags (`<div>`, `<details>`, `<kbd>`, …) used to be listed
 * here — the schema had no node for any of them, so they were dropped or stripped (content kept,
 * structure lost). `./raw-markdown-snippet.ts` now holds each construct's exact source text and
 * re-emits it byte-for-byte, so none of them lose data on round-trip and none need a pattern below.
 *
 * - **`<br>` inside a table cell** — a GFM cell can't hold a real line break, so the serializer
 *   flattens `one<br>two` to `one two`. Matched on a table-shaped line (≥2 pipes) containing a `<br>`.
 * - **Hard break inside a heading** (trailing two spaces or a backslash) — the serializer splits
 *   the heading, ejecting the second line into a separate paragraph.
 * - **HTML entity** other than the lowercase canonical `&amp;`/`&lt;`/`&gt;` (e.g. `&copy;`, `&#39;`,
 *   `&nbsp;`, or the uppercase `&AMP;`) — the serializer escapes the `&`, turning the rendered character
 *   into literal entity source. The safe-list is deliberately case-*sensitive*: `@tiptap/markdown` only
 *   round-trips the lowercase forms, so `&AMP;`/`&LT;`/`&GT;` must fall through to read-only rather than
 *   be treated as safe. A bare `&` with no matching `;`-terminated name is left alone (harmless churn).
 */
const STABLE_LOSS_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?=(?:[^\n]*\|){2})[^\n]*<br\s*\/?>/im,
  /^#{1,6}\s.*(?: {2,}|\\)$/m,
  /&(?!(?:amp|lt|gt);)(?:#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/,
]

/**
 * Strip code regions so the patterns above don't fire on code samples: fenced blocks (backtick
 * or tilde, length-matched on the closer so nested fences strip as one unit) and inline code.
 * Indented (4-space) code is deliberately NOT stripped — list/paragraph continuation lines are
 * also indented, and over-stripping would risk missing a real unsafe construct (a false negative,
 * which is worse than the rare false positive of an indented code block opening read-only).
 */
function stripCode(content: string): string {
  return content
    .replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1[`~]*[ \t]*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '')
}

/**
 * Linked images `[![alt](src)](href)`. The image node round-trips the common forms (clean URLs,
 * optional titles) via its `href` attribute, but an exotic one it can't tokenize falls back to the
 * stock parser, which drops the wrapping link — an invisible, stable loss. So instead of matching a
 * fixed pattern, {@link isRoundTripSafe} counts these before and after one serialization and rejects
 * if any disappeared.
 */
const LINKED_IMAGE_PATTERN = /\[\s*!\[[^\]]*]\([^)]*\)\s*]\([^)]*\)/g

function linkedImageCount(content: string): number {
  return content.match(LINKED_IMAGE_PATTERN)?.length ?? 0
}

/**
 * A link/image reference definition line: `[label]: destination "optional title"` (up to 3 leading
 * spaces). The `(?!\^)` excludes GFM footnote definitions (`[^id]: …`) — those are preserved verbatim
 * by the footnote node and round-trip regardless of whether their reference is present, so they must
 * not be treated as droppable orphan definitions.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)([^\]]+)]:[ \t]+\S[^\n]*$/gm

/** CommonMark reference labels match case-insensitively with internal whitespace collapsed. */
function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * True when `content` defines a link/image reference that nothing uses. A *used* reference inlines
 * losslessly on serialize (`[x][id]` + `[id]: url` → `[x](url)`), but an *unused* definition is dropped
 * entirely — a silent deletion the idempotency probe can't see (the drop happens on the first pass,
 * which is then stable). We open such a file read-only rather than lose the definition on first edit.
 * Conservative: a label counts as used if it appears bracketed anywhere in the body, so the rare
 * inline-text collision errs toward editable, never toward a false read-only.
 */
function hasOrphanReferenceDefinition(content: string): boolean {
  const labels = new Set<string>()
  for (const match of content.matchAll(REFERENCE_DEFINITION)) {
    labels.add(normalizeReferenceLabel(match[1]))
  }
  if (labels.size === 0) return false
  const body = content
    .replace(REFERENCE_DEFINITION, '')
    .replace(/\s+/g, ' ')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .toLowerCase()
  for (const label of labels) {
    if (!body.includes(`[${label}]`)) return true
  }
  return false
}

/**
 * Whether `content` survives the editor's markdown round-trip without data loss or autosave
 * churn. The editor opens the content read-only when this is false, so the probe is deliberately
 * conservative: it rejects on any doubt rather than risk an edit silently corrupting a file.
 *
 * Two complementary checks: known stable-loss constructs are matched directly (the idempotency
 * probe is blind to them), and everything else must reach a fixpoint — `serializeMarkdownDocument(x)`
 * twice in a row must be byte-identical, so the first edit can't churn the file. Lossless
 * normalizations (`_`→`*`, setext→ATX, autolink→inline, loose→tight lists) reach a fixpoint after one
 * pass and are allowed through; genuine churn (a blockquote wrapping a code fence keeps growing) is not.
 */
export function isRoundTripSafe(content: string): boolean {
  if (content.length > PROBE_SIZE_LIMIT) return false
  const stripped = stripCode(content)
  if (STABLE_LOSS_PATTERNS.some((pattern) => pattern.test(stripped))) return false
  if (hasOrphanReferenceDefinition(stripped)) return false
  try {
    const once = serializeMarkdownDocument(content)
    if (linkedImageCount(stripped) !== linkedImageCount(stripCode(once))) return false
    return serializeMarkdownDocument(once) === once
  } catch {
    return false
  }
}
