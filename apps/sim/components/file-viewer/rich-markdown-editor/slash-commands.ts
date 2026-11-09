import type { Editor, Range } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { DASHBOARD_EMBED_LANGUAGE } from '@/lib/dashboards/embed-language'

/** A time-series starter; the table id is left for the author to fill in. */
const DASHBOARD_EMBED_STARTER = `title: Rows over time
time: 7d
source:
  tableId: # table id
blocks:
  - chart: Rows per day
    source:
      groupBy: [createdAt]
      bucket: day
      aggregate:
        rows: { op: count }
    option:
      xAxis: { type: time }
      yAxis: { type: value }
      series:
        - { type: line, encode: { x: createdAt, y: rows } }
`

interface SlashCommandContext {
  editor: Editor
  range: Range
}

/**
 * Per-editor storage on the `slashCommand` extension. The editor sets `insertImage` after mount to
 * open the image picker for position `at`; it stays null where images cannot be uploaded.
 */
export interface SlashCommandStorage {
  insertImage: ((at: number) => void) | null
}

export interface SlashCommandItem {
  title: string
  /** The group heading the command is listed under. */
  group: string
  /** Further terms the typed query matches, beyond the title. */
  aliases: string[]
  shortcut?: string
  run: (context: SlashCommandContext) => void
}

const TABLE_SIZE = { rows: 3, cols: 3 } as const

/**
 * The blocks the `/` menu inserts. Each `run` deletes the typed `/query` first, so the command
 * replaces the trigger text rather than following it.
 */
const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    title: 'Text',
    group: 'Basic',
    aliases: ['paragraph', 'body'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'Heading 1',
    group: 'Basic',
    aliases: ['h1', 'title'],
    shortcut: '⌘⌥1',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    group: 'Basic',
    aliases: ['h2', 'subtitle'],
    shortcut: '⌘⌥2',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    group: 'Basic',
    aliases: ['h3'],
    shortcut: '⌘⌥3',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Bulleted list',
    group: 'Lists',
    aliases: ['unordered', 'ul', 'bullet'],
    shortcut: '⌘⇧8',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    group: 'Lists',
    aliases: ['ordered', 'ol'],
    shortcut: '⌘⇧7',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    group: 'Lists',
    aliases: ['todo', 'task', 'checkbox'],
    shortcut: '⌘⇧9',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    group: 'Blocks',
    aliases: ['blockquote', 'citation'],
    shortcut: '⌘⇧B',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    group: 'Blocks',
    aliases: ['codeblock', 'snippet', 'fence'],
    shortcut: '⌘⌥C',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Chart',
    group: 'Blocks',
    aliases: ['dashboard', 'graph', 'metric', 'live data'],
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'codeBlock',
          attrs: { language: DASHBOARD_EMBED_LANGUAGE },
          content: [{ type: 'text', text: DASHBOARD_EMBED_STARTER }],
        })
        .command(({ tr }) => {
          let fence = -1
          tr.doc.nodesBetween(range.from - 1, tr.doc.content.size, (node, pos) => {
            if (fence < 0 && node.type.name === 'codeBlock') fence = pos
            return fence < 0
          })
          if (fence < 0) return false
          tr.setSelection(TextSelection.create(tr.doc, fence + 1))
          return true
        })
        .run(),
  },
  {
    title: 'Table',
    group: 'Blocks',
    aliases: ['grid', 'rows', 'columns'],
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ ...TABLE_SIZE, withHeaderRow: true })
        .run(),
  },
  {
    title: 'Divider',
    group: 'Blocks',
    aliases: ['hr', 'horizontal rule', 'separator'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Image',
    group: 'Media',
    aliases: ['picture', 'photo', 'upload', 'img'],
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.storage.slashCommand.insertImage?.(editor.state.selection.from)
    },
  },
]

/**
 * The commands matching the typed query, in menu order. Image drops out where the editor has no
 * upload (`allowImages: false`).
 */
export function filterSlashCommands(
  query: string,
  options?: { allowImages?: boolean }
): SlashCommandItem[] {
  const allowImages = options?.allowImages ?? true
  const available = allowImages ? SLASH_COMMANDS : SLASH_COMMANDS.filter((c) => c.title !== 'Image')
  const q = query.trim().toLowerCase()
  if (!q) return [...available]
  return available.filter(
    (command) =>
      command.title.toLowerCase().includes(q) || command.aliases.some((alias) => alias.includes(q))
  )
}
