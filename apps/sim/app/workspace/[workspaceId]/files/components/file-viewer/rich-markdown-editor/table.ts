import {
  commands,
  getHTMLFromFragment,
  InputRule,
  type JSONContent,
  type MarkdownRendererHelpers,
} from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { Fragment, type Node as ProseMirrorNode, type Schema, Slice } from '@tiptap/pm/model'
import { type EditorState, Plugin, type Transaction } from '@tiptap/pm/state'
import { isInTable, selectedRect } from '@tiptap/pm/tables'

/**
 * Keep the established collaborative schema intact: older peers may already have block content in
 * cells. Newly authored content is constrained at the command/input-rule boundary instead of having
 * schema fitting silently discard existing shared content.
 */
export function selectionTouchesTable(state: EditorState): boolean {
  if (isInTable(state)) return true
  let found = false
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.type.name === 'table') found = true
    return !found
  })
  return found
}

/** Prevent Markdown block-prefix autoformat inside a GFM cell without consuming the user's text. */
export function excludeTableBlockInputRules(rules: InputRule[]): InputRule[] {
  return rules.map(
    (rule) =>
      new InputRule({
        find: rule.find,
        undoable: rule.undoable,
        handler: (props) => (selectionTouchesTable(props.state) ? null : rule.handler(props)),
      })
  )
}

/** New empty rows inherit the header's column alignment before they enter shared state. */
function alignInsertedRow(tr: Transaction, tableStart: number, rowIndex: number): void {
  const table = tr.doc.nodeAt(tableStart - 1)
  if (!table?.firstChild || rowIndex >= table.childCount) return
  let rowStart = tableStart
  for (let index = 0; index < rowIndex; index++) rowStart += table.child(index).nodeSize
  table.child(rowIndex).forEach((cell, offset, column) => {
    const align = table.firstChild?.maybeChild(column)?.attrs.align ?? null
    if (cell.attrs.align !== align) {
      tr.setNodeMarkup(rowStart + 1 + offset, undefined, { ...cell.attrs, align })
    }
  })
}

/**
 * Pasted text blocks adopt a cell's inline-only authoring contract. Preserve every inline node and
 * mark, including empty lines. Unsupported blocks return null so nested tables, media, and other
 * richer content retain their existing lossless HTML serialization instead of being flattened.
 */
function inlineCellParagraph(content: Fragment, schema: Schema): Fragment | null {
  if (content.childCount === 0) return null
  const inline: ProseMirrorNode[] = []
  for (let index = 0; index < content.childCount; index++) {
    const child = content.child(index)
    if (child.type.name !== 'paragraph' && child.type.name !== 'heading') return null
    if (index > 0) inline.push(schema.nodes.hardBreak.create())
    child.content.forEach((node) => inline.push(node))
  }
  return Fragment.from(schema.nodes.paragraph.create(null, Fragment.fromArray(inline)))
}

/** Only clipboard cells are rewritten; legacy shared nodes are never normalized during editing. */
function normalizePastedTableCells(content: Fragment, schema: Schema): Fragment {
  const nodes: ProseMirrorNode[] = []
  content.forEach((node) => {
    const isCell = node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell'
    const normalized = isCell
      ? inlineCellParagraph(node.content, schema)
      : normalizePastedTableCells(node.content, schema)
    nodes.push(normalized && !normalized.eq(node.content) ? node.copy(normalized) : node)
  })
  return Fragment.fromArray(nodes)
}

/**
 * Tables expose only operations that GFM can persist: one fixed header row, rectangular body rows,
 * inline cell content, and no merged cells or stored column widths. The header's text is editable;
 * the structural row cannot be removed independently of the table.
 */
const MarkdownTable = Table.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          transformPasted: (slice, view) => {
            const { schema } = view.state
            const inline = isInTable(view.state) ? inlineCellParagraph(slice.content, schema) : null
            if (inline) {
              return new Slice(inline, Math.min(slice.openStart, 1), Math.min(slice.openEnd, 1))
            }
            return new Slice(
              normalizePastedTableCells(slice.content, schema),
              slice.openStart,
              slice.openEnd
            )
          },
        },
      }),
    ]
  },
  addCommands() {
    const parent = this.parent?.()
    return {
      ...parent,
      setNode: (type, attributes) => (props) =>
        (!selectionTouchesTable(props.state) ||
          (typeof type === 'string' ? type : type.name) === 'paragraph') &&
        commands.setNode(type, attributes)(props),
      toggleList:
        (...args) =>
        (props) =>
          !selectionTouchesTable(props.state) && commands.toggleList(...args)(props),
      wrapInList:
        (...args) =>
        (props) =>
          !selectionTouchesTable(props.state) && commands.wrapInList(...args)(props),
      wrapIn:
        (...args) =>
        (props) =>
          !selectionTouchesTable(props.state) && commands.wrapIn(...args)(props),
      insertTable: (options) => (props) =>
        !selectionTouchesTable(props.state) &&
        (parent?.insertTable?.({ ...options, withHeaderRow: true })(props) ?? false),
      addRowBefore: () => (props) => {
        if (!isInTable(props.state)) return false
        const rect = selectedRect(props.state)
        if (rect.top === 0 || !parent?.addRowBefore?.()(props)) return false
        if (props.dispatch) alignInsertedRow(props.tr, rect.tableStart, rect.top)
        return true
      },
      addRowAfter: () => (props) => {
        if (!isInTable(props.state)) return false
        const rect = selectedRect(props.state)
        if (!parent?.addRowAfter?.()(props)) return false
        if (props.dispatch) alignInsertedRow(props.tr, rect.tableStart, rect.bottom)
        return true
      },
      deleteRow: () => (props) =>
        isInTable(props.state) &&
        selectedRect(props.state).top > 0 &&
        (parent?.deleteRow?.()(props) ?? false),
      toggleHeaderRow: () => () => false,
      toggleHeaderColumn: () => () => false,
      toggleHeaderCell: () => () => false,
      mergeCells: () => () => false,
      splitCell: () => () => false,
      mergeOrSplit: () => () => false,
      setCellAttribute: () => () => false,
    }
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => this.editor.isActive('table') && this.editor.commands.setHardBreak(),
    }
  },
})

/** A GFM table has a single header, uniform columns, inline cell content, and column-level alignment. */
function isGfmTable(node: JSONContent): boolean {
  const rows = node.content ?? []
  const header = rows[0]?.content ?? []
  return (
    header.length > 0 &&
    rows.every(
      (row, index) =>
        row.content?.length === header.length &&
        row.content.every(
          (cell, column) =>
            cell.type === (index === 0 ? 'tableHeader' : 'tableCell') &&
            (cell.attrs?.colspan ?? 1) === 1 &&
            (cell.attrs?.rowspan ?? 1) === 1 &&
            cell.attrs?.colwidth == null &&
            (cell.attrs?.align ?? null) === (header[column].attrs?.align ?? null) &&
            cell.content?.length === 1 &&
            cell.content[0].type === 'paragraph'
        )
    )
  )
}

/**
 * Render compatible cells without collapsing interior whitespace: spaces inside code spans are
 * content, not table padding. Formatting padding is bounded so one wide cell cannot multiply its
 * width across thousands of otherwise-small rows.
 */
function renderGfmTable(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      helpers
        .renderChildren(cell.content ?? [])
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>')
    )
  )
  const widths = rows[0].map(() => 3)
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.min(80, Math.max(widths[column], cell.length))
    })
  }
  const line = (cells: string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`
  const separators = widths.map((width, column) => {
    const align = node.content?.[0].content?.[column].attrs?.align
    return `${align === 'left' || align === 'center' ? ':' : ''}${'-'.repeat(width)}${
      align === 'right' || align === 'center' ? ':' : ''
    }`
  })
  return [line(rows[0]), `| ${separators.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

/**
 * Standard HTML is the lossless fallback for legacy cells with rich blocks, spans, or widths that
 * GFM cannot encode. It reopens through the existing raw-HTML node instead of silently losing those
 * attributes. The native serializer uses this editor's schema and the DOM already provisioned by
 * the client or the server collab converter; no additional DOM globals or parser are installed here.
 */
export function createMarkdownTable(): typeof MarkdownTable {
  let schema: Schema | undefined
  return MarkdownTable.extend({
    onBeforeCreate() {
      schema = this.editor.schema
    },
    renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => {
      if (isGfmTable(node)) return renderGfmTable(node, helpers)
      if (!schema) throw new Error('Table serialization requires an initialized editor schema')
      return getHTMLFromFragment(Fragment.from(schema.nodeFromJSON(node)), schema)
    },
  })
}
