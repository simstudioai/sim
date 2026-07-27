import { Editor, type JSONContent } from '@tiptap/core'
import { createMarkdownContentExtensions } from './extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'

/**
 * A single reused editor for chunked markdown parse/serialize, created lazily so importing this
 * module — including during SSR — never constructs it. `MarkdownManager.parse` is pure and re-entrant
 * (it builds its own lexer and never reads the editor's document), so sharing one instance is safe;
 * `serializeMarkdownBody` additionally reuses it as a scratchpad, overwriting its document via
 * `setContent`. Both are safe because all access is synchronous and single-threaded — each call fully
 * completes before the next — so no call ever observes another's partial state. One bounded instance
 * for the session, not a per-call allocation.
 */
let parser: Editor | null = null

function parserEditor(): Editor {
  if (!parser) parser = new Editor({ extensions: createMarkdownContentExtensions() })
  return parser
}

function markdownManager() {
  const manager = parserEditor().markdown
  if (!manager) throw new Error('Markdown extension is not installed on the parser editor')
  return manager
}

/**
 * Constructs whose meaning spans blank-line boundaries, so the document can't be split into blocks
 * without changing how they parse — these documents parse whole (correct, if slower; they're
 * uncommon and almost always round-trip-unsafe and read-only anyway):
 * - A link/image *reference definition* (`[id]: url`) or footnote definition can sit far from its
 *   `[text][id]` / `[^id]` use; splitting them apart would drop the reference. The editor never
 *   *emits* reference-style links, so this only matters on the first open of such a file.
 * - A block-level HTML element (`<div>…</div>`, `<table>…`) or HTML comment can wrap blank lines; the
 *   splitter would shatter it (matched here by a line that opens an HTML tag/comment, not inline
 *   `<https://…>` autolinks).
 */
const NON_CHUNKABLE =
  /^[ ]{0,3}(?:\[(?:\^[^\]]+|[^\]^][^\]]*)\]:\s|<(?:!--|\/?[a-zA-Z][a-zA-Z0-9-]*[\s/>]))/m

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_MARKER = /^[ ]{0,3}(?:[-*+]|\d+[.)])\s/
const BLOCKQUOTE = /^[ ]{0,3}>/

/**
 * Blank-line spacing that `@tiptap/markdown` reconstructs as *interior* or *leading* empty paragraphs —
 * a run of two or more blank lines somewhere, or blank line(s) at the document's leading edge. `[^\S\n]`
 * matches horizontal whitespace, so a "blank" line may carry spaces/tabs. This is only ever tested
 * against the `\r`-normalized body ({@link parseMarkdownToDoc}), so no CRLF handling is needed here.
 *
 * A *single* trailing blank line is deliberately not matched — purely to avoid routing an otherwise-plain
 * file to the slower whole-document parser. Correctness does not depend on it: {@link parseMarkdownToDoc}
 * strips trailing empty paragraphs on *both* parse paths ({@link stripTrailingEmptyParagraphs}), so
 * serialize→parse stays idempotent regardless of which parser ran. (A trailing run of two or more blanks
 * still matches the interior alternative — harmless, since the strip cleans it either way.)
 */
const EMPTY_PARAGRAPH_SPACING = /\n[^\S\n]*\n[^\S\n]*\n|^[^\S\n]*\n[^\S\n]*\n/

/**
 * Split a markdown body into top-level blocks that can each be parsed independently and reassembled
 * without changing meaning. Blank lines separate candidate groups (fenced code blocks stay atomic),
 * then adjacent groups are merged back together whenever they could form one logical block: any
 * indented (continuation) group, and consecutive list/blockquote groups (which would otherwise be a
 * single loose list/quote). Merging is intentionally conservative — over-merging only yields a larger
 * chunk, whereas under-merging would shatter a structure — and every block is parsed by
 * `@tiptap/markdown`'s own lexer, so block boundaries always match the parser.
 *
 * The indent-merge rule is load-bearing for fenced code indented past 3 spaces (e.g. inside a list
 * item): {@link FENCE_OPEN} only tracks fences at the document margin, so a nested fence's interior
 * blank lines are held together by the indent merge, not the fence tracker. Weakening that merge
 * would silently shatter nested fences.
 */
export function splitMarkdownBlocks(body: string): string[] {
  // Normalize CRLF/CR first: the fence/list/blockquote line tests anchor on `$`, so a trailing `\r`
  // would stop a closing fence matching and swallow the rest of a Windows-authored file into one
  // block (defeating the chunker). The editor normalizes `\r` on parse anyway, so meaning is unchanged.
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const groups: string[] = []
  let current: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (current.length > 0) groups.push(current.join('\n'))
    current = []
  }
  for (const line of lines) {
    if (fence) {
      current.push(line)
      const closer = line.match(FENCE_CLOSE)
      if (closer && closer[1][0] === fence[0] && closer[1].length >= fence.length) fence = null
      continue
    }
    const open = line.match(FENCE_OPEN)
    if (open) {
      current.push(line)
      fence = open[1]
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  // Build continuation runs and join each once — concatenating onto the growing block per group would be
  // O(n²) for one long loose list. A group continues the run when indented, or when its first line and the
  // group open the same marker kind (list or blockquote) — i.e. they form one loose list/quote.
  const runs: string[][] = []
  for (const group of groups) {
    const head = runs.length > 0 ? runs[runs.length - 1][0] : null
    const continues =
      head !== null &&
      (/^\s/.test(group) ||
        (LIST_MARKER.test(head) && LIST_MARKER.test(group)) ||
        (BLOCKQUOTE.test(head) && BLOCKQUOTE.test(group)))
    if (continues) runs[runs.length - 1].push(group)
    else runs.push([group])
  }
  return runs.map((run) => run.join('\n\n'))
}

/**
 * Parse a markdown body into a ProseMirror doc by splitting it into top-level blocks and parsing each
 * independently, then assembling the results.
 *
 * `@tiptap/markdown`'s `setContent(md, 'markdown')` is superlinear (~O(n²)) in document size, which
 * freezes the main thread at mount for large files. Parsing block-by-block is linear — measured ~22ms
 * vs ~1270ms at 61KB — and byte-identical, because each block is parsed with the same tokenizers.
 * Documents whose constructs span blocks ({@link NON_CHUNKABLE}) parse whole, and any failure falls
 * back to a single whole-document parse, so correctness never depends on the splitter.
 *
 * Blank-line spacing ({@link EMPTY_PARAGRAPH_SPACING}) also parses whole: the chunker parses each block
 * stripped of the blank lines between them, so it drops the empty paragraphs `@tiptap/markdown` builds
 * from runs of blank lines — a saved visual blank line would silently vanish on reload. Whether a gap
 * yields an empty paragraph is a global, block-type-dependent decision (kept between two paragraphs,
 * dropped after a heading), so it can't be reconstructed block-locally; these documents parse whole for
 * exact fidelity. Ordinary single-blank-line separation still takes the fast chunked path.
 */
export function parseMarkdownToDoc(body: string): JSONContent {
  const manager = markdownManager()
  // Normalize line endings up front so the routing guards see the same `\n` the chunker and parser
  // do — the guards' `\n`-anchored tests would otherwise miss a classic `\r`-only body (its blank
  // lines are `\r`), routing it to the chunker that then drops its empty paragraphs.
  const normalized = body.replace(/\r\n?/g, '\n')
  let doc: JSONContent
  if (NON_CHUNKABLE.test(normalized) || EMPTY_PARAGRAPH_SPACING.test(normalized)) {
    doc = manager.parse(normalized)
  } else {
    try {
      const content: JSONContent[] = []
      for (const block of splitMarkdownBlocks(normalized)) {
        // `MarkdownManager.parse` always returns a doc node with a `content` array; spread its blocks.
        content.push(...(manager.parse(block).content ?? []))
      }
      doc = { type: 'doc', content }
    } catch {
      doc = manager.parse(normalized)
    }
  }
  return stripTrailingEmptyParagraphs(doc)
}

/** An empty paragraph node — the shape a blank line reconstructs to (no content, or `content: []`). */
function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !node.content?.length
}

/**
 * Drop trailing empty paragraphs from a parsed doc. {@link postProcessSerializedMarkdown} collapses
 * trailing blank lines to a single newline, so a trailing empty paragraph can never round-trip — the
 * whole-document parser reconstructs one from a file ending in a blank line, but keeping it makes
 * serialize→parse non-idempotent, which flips the file read-only via the round-trip-safety probe.
 * Leading/interior empty paragraphs are untouched (postProcess never strips those). TipTap re-adds its
 * own trailing filler paragraph on `setContent`, so the editor still has a place to type.
 */
function stripTrailingEmptyParagraphs(doc: JSONContent): JSONContent {
  const content = doc.content
  if (!content || content.length === 0) return doc
  let end = content.length
  while (end > 0 && isEmptyParagraph(content[end - 1])) end--
  return end === content.length ? doc : { ...doc, content: content.slice(0, end) }
}

/**
 * Round-trip a markdown body through the editor pipeline (chunked parse → serialize), linearly. The
 * doc is loaded via `setContent` (not serialized directly) so it passes through the same schema
 * normalization the live editor applies, keeping the output identical to `editor.getMarkdown()`.
 */
export function serializeMarkdownBody(body: string): string {
  const editor = parserEditor()
  editor.commands.setContent(parseMarkdownToDoc(body), { contentType: 'json' })
  return editor.getMarkdown()
}

/**
 * Serialize a full markdown document to the editor's canonical form: frontmatter is held aside and
 * re-attached byte-exact while the body round-trips through {@link serializeMarkdownBody}. The single
 * source of this pipeline (the dirty-check baseline and the round-trip-safety probe both use it).
 */
export function serializeMarkdownDocument(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  return applyFrontmatter(frontmatter, postProcessSerializedMarkdown(serializeMarkdownBody(body)))
}
