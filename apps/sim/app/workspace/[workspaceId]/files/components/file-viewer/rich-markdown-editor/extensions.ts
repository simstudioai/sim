import { Extension, type Extensions, type JSONContent, type Node } from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import { Document } from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Paragraph } from '@tiptap/extension-paragraph'
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { splitBlockImageParagraph } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-image-paragraph'
import { JoiningBulletList } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/bullet-list'
import { MarkdownCodeBlock } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/code-block-schema'
import { Highlight } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/highlight'
import { MarkdownImage } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-schema'
import { MarkdownLinkInputRule } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/link-input-rule'
import { joinListInputRules } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/list-input-rules'
import { MarkdownListItem } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/list-item'
import { MarkdownMention } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-node'
import { SIM_LINK_SCHEME } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/sim-link'
import { createJoiningOrderedList } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/ordered-list'
import {
  FootnoteDef,
  FootnoteRef,
  RawHtmlBlock,
  RawInlineHtml,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/raw-markdown-snippet-schema'
import {
  createMarkdownTable,
  excludeTableBlockInputRules,
  selectionTouchesTable,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/table'

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

/** GFM's inline HTML keeps consecutive/leading/trailing breaks in one paragraph on reload. */
const MarkdownHardBreak = HardBreak.extend({ renderMarkdown: () => '<br>' })

const TABLE_BLOCK_PREFIX_NODES = new Set(['heading', 'blockquote', 'horizontalRule'])

/** Input rules must respect the same table capabilities as toolbar and keyboard commands. */
const TableAwareStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.type === 'node' && TABLE_BLOCK_PREFIX_NODES.has(extension.name)
        ? extension.extend({
            addCommands() {
              const parent = this.parent?.()
              if (this.name !== 'horizontalRule') return parent ?? {}
              return {
                ...parent,
                setHorizontalRule: () => (props) =>
                  !selectionTouchesTable(props.state) &&
                  (parent?.setHorizontalRule?.()(props) ?? false),
              }
            },
            addInputRules() {
              return excludeTableBlockInputRules(this.parent?.() ?? [])
            },
          })
        : extension
    )
  },
})

/** Standard HTML represents a structural empty paragraph where Markdown whitespace is ambiguous. */
const EmptyParagraphMarkdown = Extension.create({
  name: 'emptyParagraphMarkdown',
  markdownTokenName: 'html',
  parseMarkdown: (token) =>
    token.block && /^\s*<p>[ \t]*<\/p>\s*$/.test(token.raw ?? '') ? { type: 'paragraph' } : [],
})

/**
 * Blank lines between lists are loose-list spacing in CommonMark, not a paragraph. Serialize an
 * explicit empty element for that structural boundary, while retaining ordinary document spacing
 * and omitting the editor's final typing placeholder from the persisted content.
 */
const MarkdownDocument = Document.extend({
  renderMarkdown: (node: JSONContent, h) => {
    const content = node.content ?? []
    let lastContentIndex = content.length - 1
    while (
      lastContentIndex >= 0 &&
      content[lastContentIndex].type === 'paragraph' &&
      !content[lastContentIndex].content?.length
    ) {
      lastContentIndex--
    }
    return content
      .map((child, index, siblings) => {
        if (
          child.type === 'paragraph' &&
          !child.content?.length &&
          index < lastContentIndex &&
          ['bulletList', 'orderedList', 'taskList'].includes(siblings[index - 1]?.type ?? '')
        ) {
          return '<p></p>'
        }
        return h.renderChild?.(child, index) ?? h.renderChildren([child])
      })
      .join('\n\n')
  },
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
  if (!text.trim()) return text
  const stripped = text.replace(/^[ \t]+/, '')
  if (/^(#{1,6}([ \t]|$)|[-+][ \t]|-(?:[ \t]*-){2,}[ \t]*$|=+[ \t]*$)/.test(stripped)) {
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
  parseMarkdown: (token, helpers) => {
    const parsed = Paragraph.config.parseMarkdown?.(token, helpers) ?? []
    return Array.isArray(parsed) ? parsed : splitBlockImageParagraph(parsed)
  },
  renderMarkdown: (node: JSONContent, h, context) => {
    if (!node.content?.length && context.parentType === 'blockquote') return '<p></p>'
    const rendered = h.renderChildren(node.content ?? [])
    let codeDelimiter = 0
    return rendered
      .split('\n')
      .map((line) => {
        const guarded = codeDelimiter === 0 ? guardParagraphLeading(line) : line
        for (const match of line.matchAll(/\\.|`+/g)) {
          if (match[0][0] !== '`') continue
          if (codeDelimiter === 0) codeDelimiter = match[0].length
          else if (codeDelimiter === match[0].length) codeDelimiter = 0
        }
        return guarded
      })
      .join('\n')
  },
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
export function createMarkdownContentExtensions(
  nodeViews: ContentNodeViews = {},
  options: { disableHistory?: boolean } = {}
): Extensions {
  const codeBlock = (nodeViews.codeBlock ?? MarkdownCodeBlock)
    .extend({
      addInputRules() {
        return excludeTableBlockInputRules(this.parent?.() ?? [])
      },
    })
    .configure({ HTMLAttributes: { class: 'code-editor-theme' } })
  return [
    TableAwareStarterKit.configure({
      link: { openOnClick: false, protocols: [SIM_LINK_PROTOCOL] },
      underline: false,
      codeBlock: false,
      code: false,
      paragraph: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      document: false,
      hardBreak: false,
      /** Collaboration owns undo/redo whenever the document is shared. */
      ...(options.disableHistory ? { undoRedo: false as const } : {}),
    }),
    MarkdownDocument,
    BlockSafeParagraph,
    EmptyParagraphMarkdown,
    JoiningBulletList.extend({
      addInputRules() {
        return excludeTableBlockInputRules(this.parent?.() ?? [])
      },
    }),
    createJoiningOrderedList(),
    MarkdownListItem,
    MarkdownHardBreak,
    InlineCode,
    Highlight,
    codeBlock,
    (nodeViews.image ?? MarkdownImage).configure({ allowBase64: true }),
    nodeViews.mention ?? MarkdownMention,
    TaskList,
    TaskItem.extend({
      parseMarkdown: (token, helpers) => {
        const parsed = TaskItem.config.parseMarkdown?.(token, helpers) ?? []
        if (Array.isArray(parsed)) return parsed
        const content = (parsed.content ?? []).flatMap(splitBlockImageParagraph)
        if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
        return { ...parsed, content }
      },
      addInputRules() {
        return excludeTableBlockInputRules(
          joinListInputRules(
            this.parent?.() ?? [],
            this.editor.schema.nodes[this.options.taskListTypeName],
            { joinBefore: true }
          )
        )
      },
    }).configure({ nested: true }),
    createMarkdownTable().configure({ resizable: false }),
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
