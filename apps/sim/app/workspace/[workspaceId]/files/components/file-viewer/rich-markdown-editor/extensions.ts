import type { Extensions, JSONContent, MarkdownRendererHelpers, Node } from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import { TaskItem, TaskList } from '@tiptap/extension-list'
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
    }),
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
