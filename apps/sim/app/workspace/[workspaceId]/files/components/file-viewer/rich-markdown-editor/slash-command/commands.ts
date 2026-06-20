import type { Editor, Range } from '@tiptap/core'
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pilcrow,
  Table as TableIcon,
  TextQuote,
} from 'lucide-react'

export interface SlashCommandContext {
  editor: Editor
  range: Range
}

export interface SlashCommandItem {
  title: string
  /** Group heading the item is shown under in the menu. */
  group: string
  icon: LucideIcon
  /** Extra search terms matched against the slash query, beyond the title. */
  aliases: string[]
  /** Keyboard shortcut shown on the right of the item (omitted when there is none). */
  shortcut?: string
  run: (ctx: SlashCommandContext) => void
}

/**
 * The blocks insertable via the `/` menu. Each `run` first deletes the typed `/query`
 * (`deleteRange(range)`) so the command replaces the trigger text rather than appending.
 * Kept to blocks that round-trip cleanly through markdown — no media/embeds.
 */
export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    title: 'Text',
    group: 'Basic',
    icon: Pilcrow,
    aliases: ['paragraph', 'body'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'Heading 1',
    group: 'Basic',
    icon: Heading1,
    aliases: ['h1', 'title'],
    shortcut: '⌘⌥1',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    group: 'Basic',
    icon: Heading2,
    aliases: ['h2', 'subtitle'],
    shortcut: '⌘⌥2',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    group: 'Basic',
    icon: Heading3,
    aliases: ['h3'],
    shortcut: '⌘⌥3',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Bulleted list',
    group: 'Lists',
    icon: List,
    aliases: ['unordered', 'ul', 'bullet'],
    shortcut: '⌘⇧8',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    group: 'Lists',
    icon: ListOrdered,
    aliases: ['ordered', 'ol'],
    shortcut: '⌘⇧7',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    group: 'Lists',
    icon: ListChecks,
    aliases: ['todo', 'task', 'checkbox'],
    shortcut: '⌘⇧9',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    group: 'Blocks',
    icon: TextQuote,
    aliases: ['blockquote', 'citation'],
    shortcut: '⌘⇧B',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    group: 'Blocks',
    icon: Code2,
    aliases: ['codeblock', 'snippet', 'fence'],
    shortcut: '⌘⌥C',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Table',
    group: 'Blocks',
    icon: TableIcon,
    aliases: ['grid', 'rows', 'columns'],
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: 'Divider',
    group: 'Blocks',
    icon: Minus,
    aliases: ['hr', 'horizontal rule', 'separator'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
]

/**
 * Filters commands by a case-insensitive match against title or aliases. Order is
 * preserved so the menu stays stable as the query narrows.
 */
export function filterSlashCommands(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SLASH_COMMANDS]
  return SLASH_COMMANDS.filter(
    (command) =>
      command.title.toLowerCase().includes(q) || command.aliases.some((alias) => alias.includes(q))
  )
}
