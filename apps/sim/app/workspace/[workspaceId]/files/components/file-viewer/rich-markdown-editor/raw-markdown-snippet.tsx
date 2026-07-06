import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'

/**
 * Constructs the schema has no node/mark for: raw HTML blocks (`<div>`, `<details>`, …), HTML
 * comments, and footnotes. Before this file, all four made the *entire* document open read-only
 * (see {@link isRoundTripSafe in ./round-trip-safety}) because the stock pipeline silently drops
 * or mangles them. Each node below instead holds the exact source text as its content and
 * re-emits it byte-for-byte on serialize — the same "hold raw source, re-render specially" shape
 * `MarkdownCodeBlock` uses for Mermaid (see `./code-block.tsx`), just without the diagram render.
 *
 * Inline tags already covered by a real mark/node — `em`/`i`, `strong`/`b`, `s`/`del`/`strike`,
 * `code`, `a`, `br`, `img` — are deliberately excluded from {@link RawInlineHtml} so they keep
 * parsing into their proper mark (e.g. `<em>x</em>` → italic) instead of freezing as raw source.
 */
const HANDLED_INLINE_TAGS = new Set([
  'br',
  'img',
  'em',
  'i',
  'strong',
  'b',
  's',
  'del',
  'strike',
  'code',
  'a',
])

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function verbatimText(node: JSONContent): string {
  return (node.content ?? []).map((child) => child.text ?? '').join('')
}

/**
 * Marked's own block tokenizer greedily consumes the blank-line run *after* an HTML block/comment
 * or a def line as part of that token's own `raw` (the same behavior `PipeSafeTable` in
 * `./extensions.ts` works around for tables) — storing it verbatim would double it up with the
 * block joiner's own separator, growing by two newlines on every save. Block-level callers trim it;
 * inline callers never carry one (inline tokens can't span a blank line), so trimming is a no-op there.
 */
function verbatimParse(raw: string): JSONContent[] {
  const trimmed = raw.replace(/\n+$/, '')
  return trimmed ? [{ type: 'text', text: trimmed }] : []
}

interface VerbatimNodeOptions {
  name: string
  /** Whether this node sits among block content (own line) or inline content (mid-paragraph). */
  inline: boolean
  badgeLabel: string
}

/**
 * Shared shape for a node that holds a markdown construct's exact source text and re-emits it
 * unchanged — parsing and rendering never inspect or transform the text, so there is nothing for
 * these constructs to lose. `markdownTokenName`/`parseMarkdown`/`renderMarkdown` are read directly
 * off the returned config by `@tiptap/markdown`'s `MarkdownManager` (see
 * `node_modules/@tiptap/markdown/src/MarkdownManager.ts`), independent of the node's `name`.
 */
function verbatimNodeConfig({ name, inline, badgeLabel }: VerbatimNodeOptions) {
  return {
    name,
    inline,
    group: inline ? 'inline' : 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: !inline,
    selectable: true,
    atom: false,
    parseHTML() {
      return [
        {
          tag: `${inline ? 'span' : 'div'}[data-raw-markdown="${name}"]`,
          preserveWhitespace: 'full' as const,
        },
      ]
    },
    renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
      return [
        inline ? 'span' : 'div',
        mergeAttributes(HTMLAttributes, {
          'data-raw-markdown': name,
          'data-raw-markdown-label': badgeLabel,
          class: inline ? 'raw-markdown-inline' : 'raw-markdown-block',
        }),
        0,
      ] as const
    },
    renderMarkdown(node: JSONContent) {
      return verbatimText(node)
    },
  }
}

/** Block-level raw HTML — `<div>…</div>`, `<details>…</details>`, standalone `<!-- comment -->`, etc.
 * Marked's own block tokenizer already classifies all of these as a single `'html'` token
 * (`token.block === true`); `@tiptap/markdown`'s parser registry is checked *before* its built-in
 * HTML handling for block tokens (unlike inline, see {@link RawInlineHtml}), so claiming the
 * `'html'` token name here needs no custom tokenizer. */
const SKIP_BLOCK_HTML_TAGS = /^<(img|br)\b[^>]*\/?>\s*$/i

export const RawHtmlBlock = Node.create({
  ...verbatimNodeConfig({ name: 'rawHtmlBlock', inline: false, badgeLabel: 'Raw HTML' }),
  markdownTokenName: 'html',
  parseMarkdown(token: MarkdownToken) {
    if (!token.block) return null
    const raw = token.raw ?? token.text ?? ''
    if (!raw.trim()) return null
    // A lone `<img>`/`<br>` tag block — leave it to the stock path (Image node / hard break),
    // matching the same exclusion `round-trip-safety.ts` used to carve out for these two tags.
    if (SKIP_BLOCK_HTML_TAGS.test(raw.trim())) return null
    return { type: 'rawHtmlBlock', content: verbatimParse(raw) }
  },
})

const FOOTNOTE_DEF_RE = /^ {0,3}\[\^[^\]]+\]:[^\n]*\n?/

/** Footnote definition (`[^id]: the note`) — marked has no footnote syntax at all, so without this
 * tokenizer the line is swallowed as a plain paragraph and the reference/definition link is lost. */
export const FootnoteDef = Node.create({
  ...verbatimNodeConfig({ name: 'footnoteDef', inline: false, badgeLabel: 'Footnote' }),
  markdownTokenName: 'footnoteDef',
  markdownTokenizer: {
    name: 'footnoteDef',
    level: 'block' as const,
    // Always -1 (never claims an early interrupt point): when `start` is omitted, `@tiptap/markdown`
    // auto-generates one that calls `this.createLexer()` on every paragraph-continuation check, which
    // corrupts the in-progress lexer's shared state (verified directly — every other construct on the
    // page silently loses its content once a tokenizer without an explicit `start` is registered).
    // The cost is narrow and safe: a footnote def sharing a line-run with the preceding paragraph (no
    // blank line between them) is picked up on the next block boundary instead of interrupting early.
    start: () => -1,
    tokenize(src: string) {
      const match = FOOTNOTE_DEF_RE.exec(src)
      if (!match) return undefined
      return { type: 'footnoteDef', raw: match[0], text: match[0] }
    },
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return null
    return { type: 'footnoteDef', content: verbatimParse(raw) }
  },
})

const FOOTNOTE_REF_RE = /^\[\^[^\]]+\]/

/** Footnote reference (`text[^id]`) — verbatim passthrough, same rationale as {@link FootnoteDef}. */
export const FootnoteRef = Node.create({
  ...verbatimNodeConfig({ name: 'footnoteRef', inline: true, badgeLabel: 'Footnote ref' }),
  markdownTokenName: 'footnoteRef',
  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline' as const,
    // See the comment on `FootnoteDef`'s `start` — omitting it corrupts the shared lexer.
    start: () => -1,
    tokenize(src: string) {
      const match = FOOTNOTE_REF_RE.exec(src)
      if (!match) return undefined
      return { type: 'footnoteRef', raw: match[0], text: match[0] }
    },
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return null
    return { type: 'footnoteRef', content: verbatimParse(raw) }
  },
})

const RAW_HTML_COMMENT_RE = /^<!--[\s\S]*?-->/

const OPEN_TAG_RE = /^<([a-z][\w-]*)\b[^>]*?(\/)?>/i

/**
 * Attempt to consume an inline HTML comment or a tag (with its matching close tag, or as a single
 * void/self-closing element) starting at `src[0]`. Returns `undefined` for a tag this schema
 * already has a real mark/node for ({@link HANDLED_INLINE_TAGS}) so it keeps parsing normally, and
 * for an unterminated open tag (rare/malformed input — falls back to the stock, lossy behavior
 * rather than risk mis-consuming the rest of the document).
 */
function tokenizeRawInlineHtml(src: string): MarkdownToken | undefined {
  const comment = RAW_HTML_COMMENT_RE.exec(src)
  if (comment) return { type: 'rawInlineHtml', raw: comment[0], text: comment[0] }

  const open = OPEN_TAG_RE.exec(src)
  if (!open) return undefined
  const tag = open[1].toLowerCase()
  if (HANDLED_INLINE_TAGS.has(tag)) return undefined
  if (open[2] || VOID_TAGS.has(tag)) {
    return { type: 'rawInlineHtml', raw: open[0], text: open[0] }
  }

  const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
  const closeMatch = closeRe.exec(src)
  if (!closeMatch) return undefined
  const end = closeMatch.index + closeMatch[0].length
  const raw = src.slice(0, end)
  return { type: 'rawInlineHtml', raw, text: raw }
}

/** Inline raw HTML — `<kbd>`, `<sub>`, `<mark>`, `<span>`, `<u>` (no Underline mark is registered),
 * and any other tag this schema has no mark/node for, plus an inline-position HTML comment. Marked
 * classifies inline HTML as its own `'html'` token type, and `@tiptap/markdown`'s inline parser
 * hardcodes handling for that type *before* checking its extension registry (unlike block tokens) —
 * so claiming it here needs a custom tokenizer, registered under a different token name
 * (`rawInlineHtml`) so it's never confused with the stock `'html'` inline path. marked.js runs
 * custom extension tokenizers before its own built-ins at both block and inline level (see
 * `blockTokens`/`inlineTokens` in `node_modules/marked/lib/marked.esm.js`), so this reliably wins
 * the race against marked's default inline HTML/tag tokenizer. */
export const RawInlineHtml = Node.create({
  ...verbatimNodeConfig({ name: 'rawInlineHtml', inline: true, badgeLabel: 'Raw HTML' }),
  markdownTokenName: 'rawInlineHtml',
  markdownTokenizer: {
    name: 'rawInlineHtml',
    level: 'inline' as const,
    // See the comment on `FootnoteDef`'s `start` — omitting it corrupts the shared lexer.
    start: () => -1,
    tokenize: tokenizeRawInlineHtml,
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return null
    return { type: 'rawInlineHtml', content: verbatimParse(raw) }
  },
})

const BLOCK_CONTROL_CLASS =
  'pointer-events-none absolute top-1.5 right-2 select-none rounded-md bg-[var(--surface-4)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wide opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'

/** Badge text per block node type name — kept here rather than threaded through node options since
 * {@link NodeViewProps} exposes no options/extension reference to the rendering component. */
const BLOCK_BADGE_LABEL: Record<string, string> = {
  rawHtmlBlock: 'Raw HTML',
  footnoteDef: 'Footnote',
}

function RawBlockView({ node }: ReactNodeViewProps) {
  const label = BLOCK_BADGE_LABEL[node.type.name] ?? 'Raw'
  return (
    <NodeViewWrapper className='group relative'>
      <span className={BLOCK_CONTROL_CLASS} contentEditable={false}>
        {label}
      </span>
      <div className='raw-markdown-block'>
        <NodeViewContent as='span' />
      </div>
    </NodeViewWrapper>
  )
}

/** Live variant of {@link RawHtmlBlock} with a hover "Raw HTML" badge — same schema/serializer. */
export const RawHtmlBlockWithView = RawHtmlBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})

/** Live variant of {@link FootnoteDef} with a hover "Footnote" badge — same schema/serializer. */
export const FootnoteDefWithView = FootnoteDef.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RawBlockView)
  },
})
