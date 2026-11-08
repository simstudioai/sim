'use client'

import { useCallback, useState } from 'react'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  FloatingToolbar,
  ToolbarButton,
  ToolbarDivider,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/toolbar'
import {
  isImageNode,
  useBubbleMenuFloating,
  useEditorToolbar,
} from '@/platform/lib/data/files/markdown'

interface TableBubbleMenuProps {
  editor: Editor
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
 * The bar shown while the selection is in a table: insert rows and columns on either side, delete
 * them, or delete the table. The header row Markdown requires is never removed or preceded.
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
  const toolbar = useEditorToolbar({ editor, pluginKey: menuKey, canFocus })

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={menuKey}
      getReferencedVirtualElement={resolveAnchor}
      appendTo={appendTo}
      updateDelay={0}
      shouldShow={shouldShowTableMenu}
      hidden={!active.editable}
    >
      <FloatingToolbar
        label='Table editing'
        role='toolbar'
        toolbarRef={toolbar.ref}
        onFocusCapture={toolbar.onFocusCapture}
        onClickCapture={toolbar.onClickCapture}
        onKeyDown={toolbar.onKeyDown}
      >
        {active.addRowBefore && (
          <ToolbarButton
            label='Insert row above'
            icon='I023'
            onClick={() => editor.chain().focus().addRowBefore().run()}
          />
        )}
        <ToolbarButton
          label='Insert row below'
          icon='I102'
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        {active.deleteRow && (
          <ToolbarButton
            label='Delete row'
            onClick={() => editor.chain().focus().deleteRow().run()}
          />
        )}
        <ToolbarDivider />
        <ToolbarButton
          label='Insert column left'
          icon='I093'
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        />
        <ToolbarButton
          label='Insert column right'
          icon='arrow-right'
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <ToolbarButton
          label='Delete column'
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <ToolbarDivider />
        <ToolbarButton
          label='Delete table'
          onClick={() => editor.chain().focus().deleteTable().run()}
        />
      </FloatingToolbar>
    </BubbleMenu>
  )
}
