import { Editor, type JSONContent } from '@tiptap/core'
import { createMarkdownContentExtensions } from './extensions'

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
 * Split a markdown body into top-level blocks that can each be parsed independently and reassembled
 * without changing meaning. Blank lines separate candidate groups (fenced code blocks stay atomic),
 * then adjacent groups are merged back together whenever they could form one logical block: any
 * indented (continuation) group, and consecutive list/blockquote groups (which would otherwise be a
 * single loose list/quote). Merging is intentionally conservative — over-merging only yields a larger
 * chunk, whereas under-merging would shatter a structure — and every block is parsed by
 * `@tiptap/markdown`'s own lexer, so block boundaries always match the parser.
 */
export function splitMarkdownBlocks(body: string): string[] {
  const lines = body.split('\n')
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

  const blocks: string[] = []
  for (const group of groups) {
    const prev = blocks.length > 0 ? blocks[blocks.length - 1] : null
    const indented = /^\s/.test(group)
    const continues =
      prev !== null &&
      (indented ||
        (LIST_MARKER.test(prev) && LIST_MARKER.test(group)) ||
        (BLOCKQUOTE.test(prev) && BLOCKQUOTE.test(group)))
    if (continues) blocks[blocks.length - 1] = `${prev}\n\n${group}`
    else blocks.push(group)
  }
  return blocks
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
 */
export function parseMarkdownToDoc(body: string): JSONContent {
  const manager = markdownManager()
  if (NON_CHUNKABLE.test(body)) return manager.parse(body)
  try {
    const content: JSONContent[] = []
    for (const block of splitMarkdownBlocks(body)) {
      // `MarkdownManager.parse` always returns a doc node with a `content` array; spread its blocks.
      content.push(...(manager.parse(block).content ?? []))
    }
    return { type: 'doc', content }
  } catch {
    return manager.parse(body)
  }
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
