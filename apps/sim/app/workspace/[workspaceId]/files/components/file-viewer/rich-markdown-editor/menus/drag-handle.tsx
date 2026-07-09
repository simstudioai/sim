'use client'

import { useCallback, useRef } from 'react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Editor } from '@tiptap/react'
import { GripVertical, Plus } from 'lucide-react'

interface BlockDragHandleProps {
  editor: Editor
}

interface NodeChangeData {
  pos: number
}

/**
 * Inserts an empty paragraph immediately after the top-level block at `pos` and opens the slash menu
 * there, so the `+` control adds a new block below the hovered one. A no-op if `pos` doesn't resolve to
 * a node (e.g. the handle hasn't hovered a block yet).
 */
export function insertBlockBelow(editor: Editor, pos: number): void {
  const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null
  if (!node) return
  const insertAt = pos + node.nodeSize
  editor
    .chain()
    .focus()
    .insertContentAt(insertAt, { type: 'paragraph' })
    .setTextSelection(insertAt + 1)
    .insertContent('/')
    .run()
}

/** Selects the top-level block at `pos` as a NodeSelection (the grip's click affordance). */
export function selectBlockAt(editor: Editor, pos: number): void {
  if (pos < 0) return
  editor.chain().setNodeSelection(pos).run()
  editor.view.focus()
}

/**
 * Left-margin block controls revealed on block hover: a `+` that inserts a paragraph below the hovered
 * block and opens the slash menu ({@link insertBlockBelow}), and a `⠿` grip that drags to reorder (via
 * `@tiptap/extension-drag-handle`) or, on a plain click, selects the block ({@link selectBlockAt}). The
 * keyboard equivalent of the reorder is `Mod-Shift-Arrow` (see the block-mover extension).
 */
export function BlockDragHandle({ editor }: BlockDragHandleProps) {
  const hoveredPosRef = useRef(-1)

  const handleNodeChange = useCallback((data: NodeChangeData) => {
    hoveredPosRef.current = data.pos
  }, [])

  const insertBelow = useCallback(() => {
    insertBlockBelow(editor, hoveredPosRef.current)
  }, [editor])

  const selectBlock = useCallback(() => {
    selectBlockAt(editor, hoveredPosRef.current)
  }, [editor])

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange}>
      <div className='rich-md-block-controls'>
        <button
          type='button'
          aria-label='Insert block below'
          className='rich-md-block-btn'
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBelow}
        >
          <Plus size={15} strokeWidth={2} />
        </button>
        <button
          type='button'
          aria-label='Drag to reorder, or click to select the block'
          className='rich-md-block-btn rich-md-block-grip'
          onClick={selectBlock}
        >
          <GripVertical size={15} strokeWidth={2} />
        </button>
      </div>
    </DragHandle>
  )
}
