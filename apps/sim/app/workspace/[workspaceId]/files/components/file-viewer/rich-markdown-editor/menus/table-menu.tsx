import { useCallback, useState } from 'react'
import { posToDOMRect } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns3,
  Rows3,
  Table as TableIcon,
  Trash2,
} from 'lucide-react'
import { ToolbarButton, ToolbarDivider } from './toolbar-button'

/** Pins the toolbar to the viewport instead of tracking the (often wide) table as it scrolls horizontally. */
const FLOATING_OPTIONS = { strategy: 'fixed' } as const

/** Renders into the body so a transformed/clipping ancestor can't reparent the fixed toolbar and shift it. */
const APPEND_TO_BODY = () => document.body

interface TableBubbleMenuProps {
  editor: Editor
  /** The editor's scrollable viewport, used to keep the toolbar on-screen for a table taller than it. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Floating toolbar shown whenever the selection is inside a table: row/column insert-before/after,
 * row/column delete, header-row toggle, and delete-table. `@tiptap/extension-table` already exposes
 * all of these as editor commands (`addRowBefore`, `addColumnAfter`, …) — this is UI only, no schema
 * or serializer change.
 */
export function TableBubbleMenu({ editor, scrollContainerRef }: TableBubbleMenuProps) {
  const [menuKey] = useState(() => new PluginKey('markdownTableMenu'))

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      headerRow: e.isActive('tableHeader'),
    }),
  })

  // Recomputed on every call (not cached by selection key) — the same table cell can land at a
  // different screen position purely from scrolling with no selection change, and Floating UI's
  // `autoUpdate` re-invokes this on scroll/resize expecting a fresh rect each time.
  const resolveAnchor = useCallback(() => {
    const { view, state } = editor
    if (!view.dom.isConnected) return null
    const { from, to } = state.selection
    const selection = posToDOMRect(view, from, to)
    const viewport = scrollContainerRef.current?.getBoundingClientRect()
    const rect =
      viewport && selection.top < viewport.top
        ? new DOMRect(selection.left, viewport.top, selection.width, 0)
        : selection
    return { getBoundingClientRect: () => rect, getClientRects: () => [rect] }
  }, [editor, scrollContainerRef])

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={menuKey}
      getReferencedVirtualElement={resolveAnchor}
      options={FLOATING_OPTIONS}
      appendTo={APPEND_TO_BODY}
      role='toolbar'
      aria-label='Table editing'
      updateDelay={0}
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
      className='fade-in-0 z-[var(--z-popover)] flex animate-in items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-sm duration-150 ease-out motion-reduce:animate-none'
    >
      <ToolbarButton
        icon={ArrowUp}
        label='Insert row above'
        isActive={false}
        onClick={() => editor.chain().focus().addRowBefore().run()}
      />
      <ToolbarButton
        icon={ArrowDown}
        label='Insert row below'
        isActive={false}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      />
      <ToolbarButton
        icon={Rows3}
        label='Delete row'
        isActive={false}
        onClick={() => editor.chain().focus().deleteRow().run()}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={ArrowLeft}
        label='Insert column left'
        isActive={false}
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      />
      <ToolbarButton
        icon={ArrowRight}
        label='Insert column right'
        isActive={false}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      />
      <ToolbarButton
        icon={Columns3}
        label='Delete column'
        isActive={false}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={TableIcon}
        label='Toggle header row'
        isActive={active.headerRow}
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      />
      <ToolbarButton
        icon={Trash2}
        label='Delete table'
        isActive={false}
        onClick={() => editor.chain().focus().deleteTable().run()}
      />
    </BubbleMenu>
  )
}
