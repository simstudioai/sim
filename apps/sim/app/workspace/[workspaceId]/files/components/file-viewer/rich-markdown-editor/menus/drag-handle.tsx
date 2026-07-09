'use client'

import { useCallback, useRef } from 'react'
import { offset } from '@floating-ui/dom'
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
 * Nudges the handle left of the block so it clears the content edge — list markers (`1.`, `•`) hang into
 * the left padding, and without a gap the handle sits flush against them. Merged over the extension's
 * default `left-start` placement.
 */
const HANDLE_POSITION_CONFIG = { middleware: [offset(8)] }

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
 *
 * The grip is a `div` rather than a `button` on purpose: browsers don't initiate a native drag from a
 * button press, so a button grip can't start the reorder drag. The extension makes the wrapper draggable;
 * the grip just needs to not swallow that gesture.
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

  const handleGripKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      selectBlockAt(editor, hoveredPosRef.current)
    },
    [editor]
  )

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
      computePositionConfig={HANDLE_POSITION_CONFIG}
    >
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
        <div
          role='button'
          tabIndex={0}
          aria-label='Drag to reorder, or click to select the block'
          className='rich-md-block-btn rich-md-block-grip'
          onClick={selectBlock}
          onKeyDown={handleGripKeyDown}
        >
          <GripVertical size={15} strokeWidth={2} />
        </div>
      </div>
    </DragHandle>
  )
}
