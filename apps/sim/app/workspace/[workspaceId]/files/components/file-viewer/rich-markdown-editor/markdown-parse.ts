import { Editor, type JSONContent } from '@tiptap/core'
import type { Token } from 'marked'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'

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

/** Count only resolved references, never label-like text inside opaque HTML, code or link titles. */
export function hasUnusedMarkdownReference(content: string): boolean {
  const marked = markdownManager().instance
  const lexer = new marked.Lexer(marked.defaults)
  const tokens = lexer.lex(splitFrontmatter(content).body)
  const unused = new Set(Object.keys(tokens.links))
  if (!unused.size) return false
  const rules = marked.Lexer.rules.inline.gfm
  const countReference = (token: Token) => {
    if (token.type !== 'link' && token.type !== 'image') return
    const match = rules.reflink.exec(token.raw) ?? rules.nolink.exec(token.raw)
    if (match?.[0] !== token.raw) return
    const label = (match[2] || match[1]).replace(/\s+/g, ' ').toLowerCase()
    unused.delete(label)
  }
  marked.walkTokens(tokens, (token) => {
    /** Ordered-list paragraphs are tokenized before later definitions; resolve them in full context. */
    if (token.type === 'paragraph') marked.walkTokens(lexer.inlineTokens(token.raw), countReference)
    else countReference(token)
  })
  return unused.size > 0
}

/**
 * Constructs whose meaning spans blank-line boundaries, so the document can't be split into blocks
 * without changing how they parse — these documents parse whole:
 * - A link/image *reference definition* (`[id]: url`) or footnote definition can sit far from its
 *   `[text][id]` / `[^id]` use; splitting them apart would drop the reference. The editor never
 *   *emits* reference-style links, so this only matters on the first open of such a file.
 * - A block-level HTML element (`<div>…</div>`, `<table>…`) or HTML comment can wrap blank lines; the
 *   splitter would shatter it (matched here by a line that opens an HTML tag/comment, not inline
 *   `<https://…>` autolinks). The structural empty `<p></p>` element is atomic and remains chunkable.
 */
const NON_CHUNKABLE =
  /^[ ]{0,3}(?:\[(?:\^[^\]]+|[^\]^][^\]]*)\]:\s|<(?!p>[ \t]*<\/p>[ \t]*$)(?:!--|\/?[a-zA-Z][a-zA-Z0-9-]*[\s/>]))/m

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_MARKER = /^[ ]{0,3}(?:[-*+]|\d+[.)])\s/
const BLOCKQUOTE = /^[ ]{0,3}>/

/**
 * Ceiling on the empty paragraphs one gap may carry. Deliberate spacing is a handful of blank lines; a
 * run of thousands is an agent/paste artifact, and baking a node per blank would put thousands of empty
 * paragraphs in the document forever (the reported incident: ~1959 nodes from one 4000-newline run).
 * Well past any spacing a person types, low enough that no single gap can explode.
 */
const MAX_CONSECUTIVE_EMPTY_PARAGRAPHS = 20

/**
 * Ceiling on a document's TOTAL empty paragraphs, enforced by {@link boundEmptyParagraphs}. The per-gap
 * ceiling alone bounds nothing at document scale — the realistic artifact shape is a moderate blank run
 * between every paragraph, not one giant run, and that scales linearly with file size. Generous enough
 * that no hand-spaced document reaches it, finite so a machine-generated one cannot grow the node count
 * without limit.
 */
const MAX_EMPTY_PARAGRAPHS_PER_DOC = 500

/**
 * How many empty paragraphs a run of `blankLines` between two blocks carries.
 *
 * The serializer joins top-level blocks with a blank line (`blocks.join('\n\n')`), so an empty
 * paragraph costs TWO blank lines — its own, plus the separator that follows it — while the first
 * separator is free. Inverting that join is the whole rule: an interior gap of `b` blank lines carries
 * `(b - 1) / 2` empty paragraphs, a leading gap (no preceding block, so no free separator) carries
 * `b / 2`, and both round down. A hand-authored odd blank line is insignificant in markdown and
 * collapses, exactly as every standard renderer shows it; a gap the editor itself wrote reconstructs
 * exactly, which is what makes parse ∘ serialize a fixed point.
 *
 * The count is computed here rather than delegated to `@tiptap/markdown`, whose own blank-run handling
 * is not self-consistent: after a paragraph, list, blockquote, code fence, rule, or image it follows the
 * same `(b - 1) / 2`, but after a heading, an ordered list, or a table the token swallows the whole run
 * and yields nothing. Delegating would mean a blank line after a heading could never survive a save.
 *
 * Bounded here as well as in {@link clampEmptyParagraphs} so a pathological run is never materialized
 * in the first place — a megabyte of newlines would otherwise allocate half a million throwaway nodes
 * on its way to being clamped back down to {@link MAX_CONSECUTIVE_EMPTY_PARAGRAPHS}.
 */
function emptyBlockCount(blankLines: number, leading: boolean): number {
  const count = Math.floor((blankLines - (leading ? 0 : 1)) / 2)
  return Math.max(0, Math.min(count, MAX_CONSECUTIVE_EMPTY_PARAGRAPHS))
}

/**
 * Split a markdown body into top-level blocks that can each be parsed independently and reassembled
 * (by `join('\n\n')`) without changing meaning. Blank lines separate candidate groups (fenced code
 * blocks stay atomic), then adjacent groups are merged back together whenever they could form one
 * logical block: any indented (continuation) group, and consecutive list/blockquote groups (which
 * would otherwise be a single loose list/quote). Merging is intentionally conservative — over-merging
 * only yields a larger chunk, whereas under-merging would shatter a structure — and every non-empty
 * block is parsed by `@tiptap/markdown`'s own lexer, so block boundaries always match the parser.
 *
 * An EMPTY string in the result is a blank line the author left between two blocks — the exact inverse
 * of the serializer's block join (see {@link emptyBlockCount}), so a document's deliberate spacing
 * survives the round-trip instead of being silently dropped. {@link parseMarkdownToDoc} turns each into
 * an empty paragraph; a run is bounded there by {@link clampEmptyParagraphs}. Gaps are measured before
 * merging, so blank lines absorbed INTO a merged block (a loose list's own internal spacing) never
 * become paragraphs — only gaps between the final top-level blocks do. Trailing blank lines carry
 * nothing: the serializer collapses them to a single newline, so keeping them would never round-trip.
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
  /** Blank lines immediately preceding `groups[i]`, parallel to it. */
  const gaps: number[] = []
  let blanks = 0
  let current: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (current.length > 0) {
      groups.push(current.join('\n'))
      gaps.push(blanks)
      blanks = 0
    }
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
      // Flush BEFORE counting: `blanks` is the gap that preceded the group being closed here.
      flush()
      blanks++
      continue
    }
    current.push(line)
  }
  flush()

  // Build continuation runs and join each once — concatenating onto the growing block per group would be
  // O(n²) for one long loose list. A group continues the run when indented, or when its first line and the
  // group open the same marker kind (list or blockquote) — i.e. they form one loose list/quote.
  const runs: Array<{ empties: number; parts: string[] }> = []
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]
    const previous = runs.length > 0 ? runs[runs.length - 1] : null
    const head = previous?.parts[0] ?? null
    // A gap wide enough to carry an empty paragraph IS a top-level block boundary: the serializer only
    // writes one by emitting the two sides as separate blocks, so merging across it swallowed the
    // paragraph AND fused the two blocks (`- a` ∅ `- b` became one list, `> a` ∅ `> b` one quote, an
    // indented continuation absorbed the gap). Parse then stopped inverting serialize, so the file never
    // reached a fixpoint and silently opened READ-ONLY on the next open.
    const empties = emptyBlockCount(gaps[index], index === 0)
    const continues =
      head !== null &&
      empties === 0 &&
      (/^\s/.test(group) ||
        (LIST_MARKER.test(head) && LIST_MARKER.test(group)) ||
        (BLOCKQUOTE.test(head) && BLOCKQUOTE.test(group)))
    if (continues) previous?.parts.push(group)
    else runs.push({ empties, parts: [group] })
  }

  const blocks: string[] = []
  for (const run of runs) {
    for (let n = run.empties; n > 0; n--) blocks.push('')
    blocks.push(run.parts.join('\n\n'))
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
 *
 * A blank line the author left between two blocks is part of the document, not noise: the chunker hands
 * it back as an empty block (see {@link splitMarkdownBlocks}) and it becomes an empty paragraph here, so
 * the editor renders the spacing that is actually in the file — on the very first paint, with no reflow
 * once a collaborative doc settles.
 *
 * The whole-document path retains the current Markdown parser's empty paragraphs too. Structural
 * list boundaries and nested empty paragraphs serialize as standard `<p></p>` elements, so they do
 * not depend on whether the lexer interprets a blank run as spacing within a list. Both paths apply
 * the same document budget and discard trailing typing placeholders.
 */
export function parseMarkdownToDoc(body: string): JSONContent {
  const manager = markdownManager()
  // Normalize line endings up front so {@link NON_CHUNKABLE}'s `\n`-anchored tests see the same `\n`
  // the chunker and parser do — a classic `\r`-only body would otherwise slip past the reference-def /
  // block-HTML guard and be chunked, shattering a construct that must parse whole.
  const normalized = body.replace(/\r\n?/g, '\n')
  if (NON_CHUNKABLE.test(normalized)) {
    return boundEmptyParagraphs(manager.parse(normalized), MAX_EMPTY_PARAGRAPHS_PER_DOC)
  }
  try {
    const content: JSONContent[] = []
    for (const block of splitMarkdownBlocks(normalized)) {
      // An empty block is the chunker's marker for an authored blank line, and
      // `MarkdownManager.parse('')` yields a doc with no blocks — so materialize the node directly.
      if (block === '') {
        content.push({ type: 'paragraph' })
        continue
      }
      // `MarkdownManager.parse` always returns a doc node with a `content` array; spread its blocks.
      content.push(...(manager.parse(block).content ?? []))
    }
    return boundEmptyParagraphs({ type: 'doc', content }, MAX_EMPTY_PARAGRAPHS_PER_DOC)
  } catch {
    return boundEmptyParagraphs(manager.parse(normalized), MAX_EMPTY_PARAGRAPHS_PER_DOC)
  }
}

/** An empty paragraph node — the shape a blank line reconstructs to (no content, or `content: []`). */
function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !node.content?.length
}

/**
 * Bound the top-level empty paragraphs of a parsed doc to `budget` in total, and drop trailing ones
 * entirely. The same budget applies to chunked and whole-document parsing.
 *
 * The per-gap ceiling in {@link emptyBlockCount} bounds one run; this bounds the DOCUMENT. Without it the
 * ceiling buys nothing against the shape a real artifact takes — an export that puts a moderate blank run
 * between every paragraph, rather than one giant run. Measured before this budget existed: an 86KB body
 * of `x` + 42 newlines produced 39,980 empty paragraphs, twenty times the incident the ceiling cites.
 *
 * Trailing empties cannot round-trip — `postProcessSerializedMarkdown` collapses trailing blank lines to
 * a single newline, so a trailing empty paragraph would be re-serialized away and the doc would differ
 * from its own output, flipping the file read-only. Dropping them here is what keeps the probe stable
 * (TipTap re-adds its own trailing filler paragraph on `setContent`, so there is still somewhere to
 * type). Interior and leading empties DO round-trip exactly, so they are kept.
 *
 * Only TOP-LEVEL paragraphs are considered — blank lines that carry meaning inside a construct (a loose
 * list, a blockquote) live below the doc root and belong to the block parser. Returns the doc untouched,
 * with no array copy, when nothing needs bounding (the overwhelmingly common case).
 */
function boundEmptyParagraphs(doc: JSONContent, budget: number): JSONContent {
  const content = doc.content
  if (!content || content.length === 0) return doc
  // Most documents carry no empty paragraph at all, so scan before allocating anything.
  if (!content.some(isEmptyParagraph)) return doc
  let end = content.length
  while (end > 0 && isEmptyParagraph(content[end - 1])) end--
  const kept: JSONContent[] = []
  let remaining = budget
  for (let index = 0; index < end; index++) {
    const node = content[index]
    if (!isEmptyParagraph(node)) {
      kept.push(node)
      continue
    }
    if (remaining > 0) {
      remaining--
      kept.push(node)
    }
  }
  return kept.length === content.length ? doc : { ...doc, content: kept }
}

/**
 * The markdown parse in the form the EDITOR settles on — the only shape that may enter the shared
 * document.
 *
 * ProseMirror appends an empty paragraph to any document that does not end in one, so a parse ending on
 * a list, heading, table, or rule is NOT what a bound editor holds. Seeding the CRDT with the
 * un-normalized shape means the first client to bind writes that paragraph back into the SHARED
 * document — and because a trailing blank line does not survive serialization
 * (`postProcessSerializedMarkdown` collapses it) the file never records it, so nothing reconciles the
 * two and a client that seeds without seeing another's contribution adds one more. Measured on a
 * heavily-reopened document: 18 stacked empty paragraphs in the live doc against the placeholder's 1 —
 * the pane growing several hundred pixels the instant the live editor took over.
 *
 * Opt-in rather than folded into {@link parseMarkdownToDoc}, because only a writer to the SHARED
 * document has to agree with the editor. Every other consumer of the parse (paste, the round-trip
 * probe, the read-only placeholder) is rendered through a real editor that applies this itself, and
 * baking it into the parse changes what those surfaces assert. Every CRDT writer — the seed, the agent
 * merge, and the streaming frame reconciler — must go through here, or the one that does not silently
 * removes what the others add.
 */
export function editorNormalForm(markdown: string): JSONContent {
  const json = parseMarkdownToDoc(markdown)
  const content = json.content ?? []
  if (content[content.length - 1]?.type === 'paragraph') return json
  return { ...json, content: [...content, { type: 'paragraph' }] }
}

/**
 * Round-trip a markdown body through the editor pipeline (chunked parse → serialize), linearly. The
 * doc is loaded via `setContent` (not serialized directly) so it passes through the same schema
 * normalization the live editor applies, keeping the output identical to `editor.getMarkdown()`.
 */
export function serializeMarkdownBody(body: string): string {
  return serializeDocToMarkdown(parseMarkdownToDoc(body))
}

/**
 * Serialize a ProseMirror document (as TipTap {@link JSONContent}) to the editor's canonical
 * markdown. Loaded via `setContent` so it passes through the same schema normalization the live
 * editor applies — output identical to `editor.getMarkdown()`. The server-side collab-doc converter
 * uses this to project a Yjs doc back to markdown through the exact client engine (parity by
 * construction), so it must stay the single serialize path (do not inline `getMarkdown` elsewhere).
 */
export function serializeDocToMarkdown(doc: JSONContent): string {
  const editor = parserEditor()
  editor.commands.setContent(doc, { contentType: 'json' })
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
