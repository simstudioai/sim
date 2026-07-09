import type { Extensions, JSONContent, MarkdownRendererHelpers, Node } from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Paragraph } from '@tiptap/extension-paragraph'
import {
  renderTableToMarkdown,
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { MarkdownCodeBlock } from './code-block'
import { MarkdownImage } from './image'
import { MarkdownLinkInputRule } from './link-input-rule'
import { MarkdownMention } from './mention/mention-node'
import { SIM_LINK_SCHEME } from './mention/sim-link'
import { FootnoteDef, FootnoteRef, RawHtmlBlock, RawInlineHtml } from './raw-markdown-snippet'

/**
 * The `@`-mention link scheme, registered on the Link mark — without it the schema strips the
 * `sim:<kind>/<id>` href on parse/round-trip, dropping the mention. `optionalSlashes` allows the
 * slash-less `sim:kind/id` form.
 */
const SIM_LINK_PROTOCOL = { scheme: SIM_LINK_SCHEME, optionalSlashes: true } as const

/**
 * Inline code that can combine with bold/italic/strike (GFM permits `**`x`**`, `~~`x`~~`).
 * The stock Code mark sets `excludes: '_'`, which blocks every other mark from coexisting and
 * makes the bubble-menu toggles silently no-op over a code selection.
 */
const InlineCode = Code.extend({ excludes: '' })

/**
 * Table that escapes interior `|` characters when serializing cells. The upstream serializer
 * joins cells with `|` without escaping, so a cell containing a literal pipe silently splits
 * into phantom columns on round-trip (data loss). Escaping must happen on the `table` node —
 * `tableCell`/`tableHeader` have no markdown renderer; the table renders cell children directly. Only
 * `|` is escaped — `renderChildren` already escapes backslashes, so escaping them again would
 * double-escape and break round-trip idempotency (CodeQL's "missing backslash escape" is a false
 * positive here; covered by the table round-trip tests).
 *
 * The upstream serializer also wraps the table in its own leading/trailing blank lines; left in,
 * the block joiner adds another, so an interior table churns its surrounding whitespace to
 * `\n\n\n` on the first edit. Trimming the table's own output lets the joiner own the single
 * blank-line separator — without touching blank lines inside fenced code (those live in the code
 * node's text, not here).
 */
const PipeSafeTable = Table.extend({
  renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers) =>
    renderTableToMarkdown(node, {
      ...h,
      renderChildren: (nodes, separator) =>
        h.renderChildren(nodes, separator).replace(/\|/g, '\\|'),
    })
      .replace(/^\n+/, '')
      .replace(/\n+$/, ''),
})

/**
 * Guards a paragraph's serialized text so its leading characters don't re-parse it into a different
 * block on the next load:
 *
 * - **Leading whitespace** is stripped. It never renders in a paragraph (CommonMark strips up to three
 *   leading spaces, and four or more would re-parse the paragraph as an indented code block), so
 *   removing it is lossless and makes the round-trip idempotent.
 * - **A leading block marker** (`#`, `-`, `+`, `1.`, `1)`, or a bare `---`) is backslash-escaped so the
 *   paragraph doesn't become a heading / list / thematic break. The upstream serializer escapes inline
 *   delimiters (`* _ \` [ ] ~`, so `*` bullets and `>` quotes already round-trip) but not these
 *   block-starting markers. Escaping is idempotent: parsing consumes the backslash, so the stored
 *   ProseMirror text never carries it and re-serialization is stable.
 */
function guardParagraphLeading(text: string): string {
  const stripped = text.replace(/^[ \t]+/, '')
  if (/^(#{1,6}([ \t]|$)|[-+][ \t]|-(?:[ \t]*-){2,}[ \t]*$)/.test(stripped)) {
    return `\\${stripped}`
  }
  const ordered = /^(\d{1,9})([.)][ \t])/.exec(stripped)
  return ordered ? `${ordered[1]}\\${stripped.slice(ordered[1].length)}` : stripped
}

/**
 * Paragraph that guards its leading characters on serialize (see {@link guardParagraphLeading}) —
 * otherwise a paragraph beginning with a block marker or an indent silently becomes a heading / list /
 * thematic break / code block on the next load. Block separators are owned by the parent joiner, so a
 * paragraph renders as just its inline children; this override wraps that with the leading guard.
 */
const BlockSafeParagraph = Paragraph.extend({
  renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers) =>
    guardParagraphLeading(h.renderChildren(node.content ?? [])),
})

/**
 * Node-view variants the live editor injects in place of the headless defaults — the code-block
 * language picker, the resizable image, and the mention chip. The mention chip pulls the block registry
 * (for brand icons), so the headless round-trip path omits it: passing nothing keeps
 * {@link createMarkdownContentExtensions} free of the registry and constructs no React node views.
 */
export interface ContentNodeViews {
  codeBlock?: Node
  image?: Node
  mention?: Node
  rawHtmlBlock?: Node
  footnoteDef?: Node
}

/**
 * The schema + serialization extensions: the nodes/marks the document can contain and the
 * Markdown ⇄ ProseMirror conversion. `StarterKit` provides core nodes/marks and the
 * Markdown-style input rules (`# `, `- `, `**bold**`, …); `TaskList`/`TaskItem` add
 * `- [ ]` checklists; `TableKit` adds GFM tables; `Markdown` serializes back to markdown.
 *
 * Headless by default (the `nodeViews` overrides are empty), so importing this module — e.g. for the
 * markdown round-trip in `markdown-parse.ts` — never constructs React node views or pulls the block
 * registry. The live editor passes the node-view nodes via {@link createMarkdownEditorExtensions}; the
 * schema and markdown output are identical either way.
 */
export function createMarkdownContentExtensions(nodeViews: ContentNodeViews = {}): Extensions {
  const codeBlock = (nodeViews.codeBlock ?? MarkdownCodeBlock).configure({
    HTMLAttributes: { class: 'code-editor-theme' },
  })
  return [
    StarterKit.configure({
      link: { openOnClick: false, protocols: [SIM_LINK_PROTOCOL] },
      underline: false,
      codeBlock: false,
      code: false,
      paragraph: false,
    }),
    BlockSafeParagraph,
    InlineCode,
    codeBlock,
    (nodeViews.image ?? MarkdownImage).configure({ allowBase64: true }),
    nodeViews.mention ?? MarkdownMention,
    TaskList,
    TaskItem.configure({ nested: true }),
    PipeSafeTable.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    nodeViews.rawHtmlBlock ?? RawHtmlBlock,
    nodeViews.footnoteDef ?? FootnoteDef,
    FootnoteRef,
    RawInlineHtml,
    MarkdownLinkInputRule,
    Markdown,
  ]
}
