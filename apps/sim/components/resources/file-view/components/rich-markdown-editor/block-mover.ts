import { Extension } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

/** The position range of the depth-1 block containing the cursor, or null at the document root. */
function currentTopLevelBlock(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection
  if ($from.depth === 0) return null
  return { from: $from.before(1), to: $from.after(1) }
}

/**
 * Swaps the current top-level block with its neighbour in `direction`, keeping the caret on the moved
 * block. Adjacent top-level blocks share a boundary position (no separator token between them), so the
 * move is a single `replaceWith` of the two-block span with the pair reordered. No-ops (returns false)
 * at the matching document edge or when the neighbour isn't a top-level block. `newBefore` is the moved
 * block's new `before(1)` position; adding the caret's original offset (`selection.from - from`, also
 * measured from `before(1)`) re-anchors the caret at the same spot within the block.
 */
function moveBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: 'up' | 'down'
): boolean {
  const block = currentTopLevelBlock(state)
  if (!block) return false
  const { from, to } = block
  const up = direction === 'up'

  if (up ? from === 0 : to >= state.doc.content.size) return false
  const $neighbour = state.doc.resolve(up ? from - 1 : to + 1)
  if ($neighbour.depth === 0) return false
  if (!dispatch) return true

  const spanFrom = up ? $neighbour.before(1) : from
  const spanTo = up ? to : $neighbour.after(1)
  const moving = state.doc.slice(from, to).content
  const neighbour = up
    ? state.doc.slice(spanFrom, from).content
    : state.doc.slice(to, spanTo).content
  const tr = state.tr.replaceWith(
    spanFrom,
    spanTo,
    up ? moving.append(neighbour) : neighbour.append(moving)
  )

  const newBefore = up ? spanFrom : spanFrom + neighbour.size
  const offset = state.selection.from - from
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(newBefore + offset, newBefore + moving.size)))
  )
  dispatch(tr.scrollIntoView())
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockMover: {
      /** Move the current top-level block up one position, carrying the caret. */
      moveBlockUp: () => ReturnType
      /** Move the current top-level block down one position, carrying the caret. */
      moveBlockDown: () => ReturnType
    }
  }
}

/**
 * Reorders the current top-level block with `Mod-Shift-ArrowUp`/`ArrowDown` — the standard
 * keyboard block-move affordance (Notion/Obsidian). Pure UI interaction: no schema change, and the
 * caret rides along with the block. A no-op (returns false, falling through) at the document edges.
 */
export const BlockMover = Extension.create({
  name: 'blockMover',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, dispatch }) =>
          moveBlock(state, dispatch, 'up'),
      moveBlockDown:
        () =>
        ({ state, dispatch }) =>
          moveBlock(state, dispatch, 'down'),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowUp': ({ editor }) => editor.commands.moveBlockUp(),
      'Mod-Shift-ArrowDown': ({ editor }) => editor.commands.moveBlockDown(),
    }
  },
})
