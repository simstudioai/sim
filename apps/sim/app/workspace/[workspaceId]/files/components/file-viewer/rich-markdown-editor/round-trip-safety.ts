import { Editor } from '@tiptap/core'
import { createMarkdownContentExtensions } from './extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'

/**
 * Above this size we don't run the (synchronous) round-trip probe — building two editors to
 * serialize a large document blocks the main thread for too long, and a very large markdown file
 * is heavier to edit richly anyway, so it opens in the raw editor.
 */
const PROBE_SIZE_LIMIT = 128 * 1024

/**
 * Constructs the editor drops or mangles in a way that survives a second serialization
 * unchanged — so the idempotency probe below can't see the loss. Each must be matched directly.
 *
 * - **Linked image** `[![alt](img)](href)` — the schema can't nest an image in a link, so the
 *   wrapping href is dropped.
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
  /\[\s*!\[[^\]]*]\([^)]*\)\s*]\([^)]*\)/,
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
 * which is worse than the rare false positive of an indented code block opening in the raw editor).
 */
function stripCode(content: string): string {
  return content
    .replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1[`~]*[ \t]*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '')
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
 * churn. Callers fall back to the raw text editor when this is false, so the gate is
 * deliberately conservative: it rejects on any doubt rather than risk silently corrupting a file.
 *
 * Two complementary checks: known stable-loss constructs are matched directly (the idempotency
 * probe is blind to them), and everything else must reach a fixpoint — `serialize(x)` twice in a
 * row must be byte-identical, so the first edit can't churn the file. Lossless normalizations
 * (`_`→`*`, setext→ATX, autolink→inline, loose→tight lists) reach a fixpoint after one pass and
 * are allowed through; genuine churn (a blockquote wrapping a code fence keeps growing) is not.
 */
export function isRoundTripSafe(content: string): boolean {
  if (content.length > PROBE_SIZE_LIMIT) return false
  if (STABLE_LOSS_PATTERNS.some((pattern) => pattern.test(stripCode(content)))) return false
  try {
    const once = serialize(content)
    return serialize(once) === once
  } catch {
    return false
  }
}
