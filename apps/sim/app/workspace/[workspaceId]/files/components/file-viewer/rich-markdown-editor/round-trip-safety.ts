import { Editor } from '@tiptap/core'
import { createMarkdownContentExtensions } from './extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'

/**
 * Above this size we don't run the (synchronous) round-trip probe, and the file opens read-only.
 * The probe builds throwaway editors and parses the markdown, and `@tiptap/markdown`'s parse is
 * superlinear (~O(n²)) in document size — measured ~170ms at 11KB, ~875ms at 23KB, multiple seconds
 * past ~35KB — so a high cap means a multi-second main-thread freeze at mount. 24KB keeps the
 * worst-case probe near a second while still covering the vast majority of real markdown files; a
 * very large markdown file is also heavier to edit richly anyway. The editor's own markdown parse
 * shares this cost, so the cap protects mount render too.
 */
const PROBE_SIZE_LIMIT = 24 * 1024

/**
 * Constructs the editor drops or mangles in a way that survives a second serialization
 * unchanged — so the idempotency probe below can't see the loss. Each must be matched directly.
 * (Linked images `[![alt](img)](href)` are handled by the image node and verified separately by
 * the link-count check in {@link isRoundTripSafe}, not here.)
 *
 * - **Footnote** `[^id]` — not in the schema; the reference and definition serialize to escaped
 *   literal text, breaking the footnote.
 * - **HTML comment** `<!-- … -->` — dropped entirely.
 * - **Raw HTML tag** `<div>`, `<details>`, `<kbd>`, … — StarterKit has no HTML node, so the tag
 *   is stripped (content kept, structure lost). `<br>` and `<img>` are excluded: `<br>` outside a
 *   table converts to a hard break, and `<img>` is a first-class (resizable) image node.
 * - **`<br>` inside a table cell** — a GFM cell can't hold a real line break, so the serializer
 *   flattens `one<br>two` to `one two`. Matched on a table-shaped line (≥2 pipes) containing a `<br>`.
 * - **Hard break inside a heading** (trailing two spaces or a backslash) — the serializer splits
 *   the heading, ejecting the second line into a separate paragraph.
 * - **HTML entity** other than `&amp;`/`&lt;`/`&gt;` (e.g. `&copy;`, `&#39;`, `&nbsp;`) — the
 *   serializer escapes the `&`, turning the rendered character into literal entity source. A bare
 *   `&` with no `;` is left alone (it re-renders identically, so it's harmless churn).
 */
const STABLE_LOSS_PATTERNS: ReadonlyArray<RegExp> = [
  /\[\^[^\]]+]/,
  /<!--/,
  /<\/?(?!(?:br|img)\b)[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i,
  /^(?=(?:[^\n]*\|){2})[^\n]*<br\s*\/?>/im,
  /^#{1,6}\s.*(?: {2,}|\\)$/m,
  /&(?!(?:amp|lt|gt);)(?:#x?[0-9a-f]+|[a-z][a-z0-9]*);/i,
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

/** Serialize markdown through the exact editor pipeline (frontmatter held aside). */
function serialize(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const editor = new Editor({ extensions: createMarkdownContentExtensions() })
  try {
    editor.commands.setContent(body, { contentType: 'markdown' })
    return applyFrontmatter(frontmatter, postProcessSerializedMarkdown(editor.getMarkdown()))
  } finally {
    editor.destroy()
  }
}

/**
 * Whether `content` survives the editor's markdown round-trip without data loss or autosave
 * churn. The editor opens the content read-only when this is false, so the probe is deliberately
 * conservative: it rejects on any doubt rather than risk an edit silently corrupting a file.
 *
 * Two complementary checks: known stable-loss constructs are matched directly (the idempotency
 * probe is blind to them), and everything else must reach a fixpoint — `serialize(x)` twice in a
 * row must be byte-identical, so the first edit can't churn the file. Lossless normalizations
 * (`_`→`*`, setext→ATX, autolink→inline, loose→tight lists) reach a fixpoint after one pass and
 * are allowed through; genuine churn (a blockquote wrapping a code fence keeps growing) is not.
 */
export function isRoundTripSafe(content: string): boolean {
  if (content.length > PROBE_SIZE_LIMIT) return false
  const stripped = stripCode(content)
  if (STABLE_LOSS_PATTERNS.some((pattern) => pattern.test(stripped))) return false
  try {
    const once = serialize(content)
    if (linkedImageCount(stripped) !== linkedImageCount(stripCode(once))) return false
    return serialize(once) === once
  } catch {
    return false
  }
}
