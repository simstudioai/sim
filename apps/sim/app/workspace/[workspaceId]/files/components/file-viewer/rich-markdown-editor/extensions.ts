import type { Extensions, JSONContent, MarkdownRendererHelpers } from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import {
  renderTableToMarkdown,
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockWithLanguage, MarkdownCodeBlock } from './code-block'
import { CodeBlockHighlight } from './code-highlight'
import { MarkdownImage, ResizableImage } from './image'
import { RichMarkdownKeymap } from './keymap'
import { MarkdownLinkInputRule } from './link-input-rule'
import { MarkdownPaste } from './markdown-paste'
import { SlashCommand } from './slash-command/slash-command'

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

interface MarkdownEditorExtensionOptions {
  placeholder: string
}

interface ContentExtensionOptions {
  /** Use the React node views (code-block language picker, image resize). Off for headless tests. */
  nodeViews?: boolean
}

/**
 * The schema + serialization extensions: the nodes/marks the document can contain and the
 * Markdown ⇄ ProseMirror conversion. `StarterKit` provides core nodes/marks and the
 * Markdown-style input rules (`# `, `- `, `**bold**`, …); `TaskList`/`TaskItem` add
 * `- [ ]` checklists; `TableKit` adds GFM tables; `Markdown` serializes back to markdown.
 *
 * The code block is the standalone `CodeBlock` so the live editor can swap in a node view;
 * the schema and markdown output are identical either way.
 */
export function createMarkdownContentExtensions({
  nodeViews = false,
}: ContentExtensionOptions = {}): Extensions {
  const codeBlock = (nodeViews ? CodeBlockWithLanguage : MarkdownCodeBlock).configure({
    HTMLAttributes: { class: 'code-editor-theme' },
  })
  return [
    StarterKit.configure({
      link: { openOnClick: false },
      underline: false,
      codeBlock: false,
      code: false,
    }),
    InlineCode,
    codeBlock,
    (nodeViews ? ResizableImage : MarkdownImage).configure({ allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    PipeSafeTable.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    MarkdownLinkInputRule,
    Markdown,
  ]
}

/**
 * The full extension set for the live editor: the content extensions plus the UI-only
 * extensions — `CodeBlockHighlight` (Prism), `SlashCommand` (the `/` block menu), and
 * `Placeholder`.
 */
export function createMarkdownEditorExtensions({
  placeholder,
}: MarkdownEditorExtensionOptions): Extensions {
  return [
    ...createMarkdownContentExtensions({ nodeViews: true }),
    CodeBlockHighlight,
    SlashCommand,
    RichMarkdownKeymap,
    MarkdownPaste,
    Placeholder.configure({ placeholder }),
  ]
}
