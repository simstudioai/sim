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

const RAW_HTML_COMMENT_RE = /^<!--[\s\S]*?-->/

/**
 * One HTML attribute: `name` or `name="value"`/`name='value'`/`name=bare`. The quoted-value
 * alternatives are what matter — `[^"]*`/`[^']*` consume a literal `>` inside the quotes as part of
 * the value, so an attribute like `data-example="a > b"` is treated as one unit instead of ending
 * the tag match at the internal `>`.
 */
const ATTRS_RE_SOURCE = String.raw`(?:\s+[^\s"'=<>\`]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\`]+))?)*`

/** Matches one opening HTML tag, attributes included (see {@link ATTRS_RE_SOURCE}). Group 1 is the
 * tag name, group 2 is the self-closing `/` if present — shared by inline and block tokenizing. */
const OPEN_TAG_RE = new RegExp(`^<([a-z][\\w-]*)\\b${ATTRS_RE_SOURCE}\\s*(/)?>`, 'i')

/** A fenced block's opening/closing marker may sit inside a blockquote (each line prefixed with
 * up to 3 spaces then one or more `>` markers, each optionally followed by a space) and/or be
 * independently indented up to 3 spaces with no blockquote at all (CommonMark's own fence-indent
 * tolerance — matches `FENCE_OPEN`/`FENCE_CLOSE` in `./markdown-parse.ts`) — matched on both the
 * open and close fence line so `> \`\`\`` and `   \`\`\`` both mask correctly. */
const FENCE_PREFIX_SOURCE = '(?:[ ]{0,3}>[ ]?)*[ ]{0,3}'

/**
 * Mask fenced code blocks and inline code spans with same-length filler (newlines kept, everything
 * else replaced with a space) so a tag-like mention *inside code* — `` `</details>` ``, or a fenced
 * example showing HTML syntax — is never mistaken for a real balancing tag while scanning. Mirrors
 * the fenced/inline patterns `stripCode` in `./round-trip-safety.ts` matches (extended to also
 * tolerate an indented and/or blockquoted fence marker via {@link FENCE_PREFIX_SOURCE}, since a raw
 * HTML block can itself be indented or quoted), but preserves length/position (masks in place)
 * instead of deleting, so match indices still map
 * onto the original, unmodified `src` the caller slices from.
 */
function maskCodeRegions(src: string): string {
  const fenceRe = new RegExp(
    `^${FENCE_PREFIX_SOURCE}([\`~]{3,})[^\\n]*\\n[\\s\\S]*?^${FENCE_PREFIX_SOURCE}\\1[\`~]*[ \\t]*$`,
    'gm'
  )
  return src
    .replace(fenceRe, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`+[^`\n]*`+/g, (m) => ' '.repeat(m.length))
}

/**
 * Find the end of the close tag that balances the open tag of `tag` ending at `src[0, fromIndex)`,
 * tracking nesting depth from `fromIndex` onward so `<span>outer <span>inner</span></span>` consumes
 * both levels instead of stopping at the first (inner) `</span>`. Returns -1 if unterminated. A
 * nested self-closing same-name tag (`<span/>`) is skipped — it neither opens nor closes a level.
 * Shared by the inline tokenizer (single line) and the block tokenizer (spans blank lines).
 *
 * Scans a {@link maskCodeRegions}-masked copy of `src` so a tag name mentioned inside code doesn't
 * count as real markup — this narrows, but can't eliminate, the inherent ambiguity of regex-based
 * (non-DOM) tag matching: a *bare, unescaped* mention of the same tag name in plain prose (not in
 * code) is indistinguishable from a real closing tag here, exactly as it would be to a real HTML
 * parser given the same ambiguous input (there is no valid way to "escape" a literal `</tag>` inside
 * real HTML content other than an entity or code region). Verified this can't lose data even in that
 * case — the result still reaches a stable fixpoint on save, just restructured — matching this file's
 * "reject on doubt, but never require doubt-free input" gate (`isRoundTripSafe`).
 */
function findBalancedCloseEnd(src: string, tag: string, fromIndex: number): number {
  const masked = maskCodeRegions(src)
  const tagRe = new RegExp(`<(/?)${tag}\\b${ATTRS_RE_SOURCE}\\s*(/)?>`, 'gi')
  tagRe.lastIndex = fromIndex
  let depth = 1
  for (let match = tagRe.exec(masked); match; match = tagRe.exec(masked)) {
    const isClose = match[1] === '/'
    const isSelfClosing = Boolean(match[2])
    if (isSelfClosing) continue
    if (isClose) {
      depth -= 1
      if (depth === 0) return match.index + match[0].length
    } else {
      depth += 1
    }
  }
  return -1
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

/**
 * Tag names CommonMark/GFM treat as "block-starting" HTML (marked's own type-6 list — see
 * `_tag` in `node_modules/marked/src/rules.ts`, verified against the CommonMark spec): a block
 * opening with one of these ends at its *matching closing tag*, not at the first blank line. Tags
 * NOT in this list (`em`, `a`, `span`, `code`, `kbd`, …) can legitimately start an ordinary
 * paragraph (`<em>hi</em> there`), so they're deliberately left to marked's own stricter, single-line
 * block-HTML detection below — claiming them here would risk swallowing a paragraph that merely
 * starts with inline HTML.
 */
const BLOCK_HTML_TAG_NAMES = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'meta',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
])

/**
 * Marked's built-in block-HTML rule ends a `<details>`/`<div>`/… block at the *first blank line*
 * (CommonMark's HTML-block-type-6 rule) — correct for normal rendering, but wrong for verbatim
 * preservation: any real-world `<details>` with a paragraph inside would fragment into a raw chip,
 * an ordinary (rendered) paragraph, and a second raw chip, stranding genuine content in between.
 * This tokenizer instead scans to the tag's *matching* close via {@link findBalancedCloseEnd}, blank
 * lines included, for tags in {@link BLOCK_HTML_TAG_NAMES}; anything else returns `undefined` and
 * falls through to the existing `markdownTokenName: 'html'` handling below (marked's own block
 * tokenizer, unchanged). Comments are matched the same way as the inline case — marked's own comment
 * rule already spans blank lines correctly, but routing through one path keeps the two tokenizers
 * symmetric and independently testable. CommonMark allows up to 3 leading spaces before a block-HTML
 * opening line, so the leading indent is split off, matched against separately, and stitched back
 * onto `raw` — everything after that first line (including the tag's own body) can be indented
 * however the author wrote it, since the balanced scan doesn't care about column position there.
 */
function tokenizeRawHtmlBlockTag(src: string): MarkdownToken | undefined {
  const indent = /^ {0,3}/.exec(src)?.[0] ?? ''
  const rest = src.slice(indent.length)

  const comment = RAW_HTML_COMMENT_RE.exec(rest)
  if (comment) {
    const raw = indent + comment[0]
    return { type: 'html', raw, text: raw, block: true }
  }

  const open = OPEN_TAG_RE.exec(rest)
  if (!open) return undefined
  const tag = open[1].toLowerCase()
  if (!BLOCK_HTML_TAG_NAMES.has(tag)) return undefined
  // A handful of BLOCK_HTML_TAG_NAMES entries (link, meta, base, col, …) are void elements with no
  // closing tag at all — treat them as complete right after the open tag (like an explicit `/>`),
  // same as `tokenizeRawInlineHtml` already does via VOID_TAGS. Without this, scanning for a
  // `</meta>`/`</link>` that will never legitimately appear risks grabbing unrelated later content
  // (or a stray same-name mention) as if it belonged to this block.
  if (open[2] || VOID_TAGS.has(tag)) {
    const raw = indent + open[0]
    return { type: 'html', raw, text: raw, block: true }
  }

  const end = findBalancedCloseEnd(rest, tag, open[0].length)
  if (end < 0) return undefined
  const raw = indent + rest.slice(0, end)
  return { type: 'html', raw, text: raw, block: true }
}

const SKIP_BLOCK_HTML_TAGS = /^<(img|br)\b[^>]*\/?>\s*$/i

export const RawHtmlBlock = Node.create({
  ...verbatimNodeConfig({ name: 'rawHtmlBlock', inline: false, badgeLabel: 'Raw HTML' }),
  markdownTokenName: 'html',
  markdownTokenizer: {
    name: 'rawHtmlBlockTag',
    level: 'block' as const,
    // Always -1 (never claims an early interrupt point): when `start` is omitted, `@tiptap/markdown`
    // auto-generates one that calls `this.createLexer()` on every paragraph-continuation check, which
    // corrupts the in-progress lexer's shared state (verified directly — every other construct on the
    // page silently loses its content once a tokenizer without an explicit `start` is registered).
    // The other custom tokenizers below all reference this comment rather than repeating it.
    //
    // The tokenizer above emits `type: 'html'` explicitly, so its tokens flow into the same
    // `markdownTokenName: 'html'` parse registration as marked's own block-HTML tokens below — the
    // distinct `name` here only avoids colliding with marked's own built-in `html` extension.
    start: () => -1,
    tokenize: tokenizeRawHtmlBlockTag,
  },
  parseMarkdown(token: MarkdownToken) {
    if (!token.block) return []
    const raw = token.raw ?? token.text ?? ''
    if (!raw.trim()) return []
    // A lone `<img>`/`<br>` tag block — leave it to the stock path (Image node / hard break),
    // matching the same exclusion `round-trip-safety.ts` used to carve out for these two tags.
    if (SKIP_BLOCK_HTML_TAGS.test(raw.trim())) return []
    return { type: 'rawHtmlBlock', content: verbatimParse(raw) }
  },
})

const FOOTNOTE_DEF_HEAD_RE = /^ {0,3}\[\^[^\]]+\]:/
const FOOTNOTE_CONTINUATION_RE = /^ {4,}\S/

/**
 * Consume a footnote definition's opening line plus any continuation lines GFM allows — indented by
 * ≥4 spaces, optionally with blank lines between them (a multi-paragraph definition). Stops at the
 * first line that is neither indented nor blank, and never consumes a blank line that isn't followed
 * by further continuation (that blank line belongs to whatever block comes next).
 */
function tokenizeFootnoteDef(src: string): MarkdownToken | undefined {
  const lines = src.split('\n')
  if (!FOOTNOTE_DEF_HEAD_RE.test(lines[0])) return undefined
  let lineCount = 1
  while (lineCount < lines.length) {
    const line = lines[lineCount]
    if (FOOTNOTE_CONTINUATION_RE.test(line)) {
      lineCount += 1
      continue
    }
    if (line === '' && FOOTNOTE_CONTINUATION_RE.test(lines[lineCount + 1] ?? '')) {
      lineCount += 2
      continue
    }
    break
  }
  const raw = lines.slice(0, lineCount).join('\n')
  return { type: 'footnoteDef', raw, text: raw }
}

/** Footnote definition (`[^id]: the note`, with optional ≥4-space-indented continuation lines) —
 * marked has no footnote syntax at all, so without this tokenizer the definition is swallowed as a
 * plain paragraph and the reference/definition link is lost. */
export const FootnoteDef = Node.create({
  ...verbatimNodeConfig({ name: 'footnoteDef', inline: false, badgeLabel: 'Footnote' }),
  markdownTokenName: 'footnoteDef',
  markdownTokenizer: {
    name: 'footnoteDef',
    level: 'block' as const,
    // See the comment on `RawHtmlBlock`'s `start` — omitting it corrupts the shared lexer. The cost
    // here is narrow and safe: a footnote def sharing a line-run with the preceding paragraph (no
    // blank line between them) is picked up on the next block boundary instead of interrupting early.
    start: () => -1,
    tokenize: tokenizeFootnoteDef,
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return []
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
    // See the comment on `RawHtmlBlock`'s `start` — omitting it corrupts the shared lexer.
    start: () => -1,
    tokenize(src: string) {
      const match = FOOTNOTE_REF_RE.exec(src)
      if (!match) return undefined
      return { type: 'footnoteRef', raw: match[0], text: match[0] }
    },
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return []
    return { type: 'footnoteRef', content: verbatimParse(raw) }
  },
})

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

  const end = findBalancedCloseEnd(src, tag, open[0].length)
  if (end < 0) return undefined
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
    // See the comment on `RawHtmlBlock`'s `start` — omitting it corrupts the shared lexer.
    start: () => -1,
    tokenize: tokenizeRawInlineHtml,
  },
  parseMarkdown(token: MarkdownToken) {
    const raw = token.raw ?? token.text ?? ''
    if (!raw) return []
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
        <NodeViewContent<'span'> as='span' />
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
