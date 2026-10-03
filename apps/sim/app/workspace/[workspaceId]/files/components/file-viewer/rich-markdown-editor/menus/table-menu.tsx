import { useCallback, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Rows3, Trash } from '@sim/emcn/icons'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'
import { BUBBLE_MENU_CLASS } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu-chrome'
import {
  ToolbarButton,
  ToolbarDivider,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'
import { useBubbleMenuFloating } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-bubble-menu-floating'
import { useEditorToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-editor-toolbar'

interface TableBubbleMenuProps {
  editor: Editor
  /** The editor's scrollable viewport, so the toolbar repositions with the cell as the pane scrolls. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

const shouldShowTableMenu = ({ editor }: { editor: Editor }) => {
  const { selection } = editor.state
  return (
    editor.isEditable &&
    editor.isActive('table') &&
    !(selection instanceof NodeSelection && isImageNode(selection.node))
  )
}

/**
 * Floating toolbar shown whenever the selection is inside a table: row/column insert-before/after,
 * row/column delete, and delete-table. The fixed header row is required by the Markdown storage
 * format; capability checks omit operations that would remove it or insert a body row before it.
 */
export function TableBubbleMenu({ editor, scrollContainerRef }: TableBubbleMenuProps) {
  const [menuKey] = useState(() => new PluginKey('markdownTableMenu'))

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      addRowBefore: e.can().addRowBefore(),
      deleteRow: e.can().deleteRow(),
    }),
  })

  const { resolveAnchor, appendTo } = useBubbleMenuFloating(editor, scrollContainerRef)
  const canFocus = useCallback(
    () =>
      shouldShowTableMenu({ editor }) &&
      editor.state.doc
        .textBetween(editor.state.selection.from, editor.state.selection.to, ' ')
        .trim().length === 0,
    [editor]
  )
  const toolbar = useEditorToolbar({
    editor,
    pluginKey: menuKey,
    canFocus,
  })

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={menuKey}
      getReferencedVirtualElement={resolveAnchor}
      appendTo={appendTo}
      updateDelay={0}
      shouldShow={shouldShowTableMenu}
      hidden={!active.editable}
      className={BUBBLE_MENU_CLASS}
    >
      <div
        {...toolbar}
        role='toolbar'
        aria-label='Table editing'
        className='flex items-center gap-0.5'
      >
        {active.addRowBefore && (
          <ToolbarButton
            icon={ArrowUp}
            label='Insert row above'
            onClick={() => editor.chain().focus().addRowBefore().run()}
          />
        )}
        <ToolbarButton
          icon={ArrowDown}
          label='Insert row below'
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        {active.deleteRow && (
          <ToolbarButton
            icon={Rows3}
            label='Delete row'
            onClick={() => editor.chain().focus().deleteRow().run()}
          />
        )}
        <ToolbarDivider />
        <ToolbarButton
          icon={ArrowLeft}
          label='Insert column left'
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        />
        <ToolbarButton
          icon={ArrowRight}
          label='Insert column right'
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <ToolbarButton
          icon={Columns3}
          label='Delete column'
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={Trash}
          label='Delete table'
          onClick={() => editor.chain().focus().deleteTable().run()}
        />
      </div>
    </BubbleMenu>
  )
}
