import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { NodeSelection } from '@tiptap/pm/state'
import { ReplaceAroundStep, StepMap } from '@tiptap/pm/transform'

/** The contiguous top-level blocks touched by a text range or node selection. */
function currentTopLevelBlocks(state: EditorState): { from: number; to: number } | null {
  const { selection } = state
  const { $from, $to } = selection
  if ($from.depth === 0 && !(selection instanceof NodeSelection)) return null
  return {
    from: $from.depth > 0 ? $from.before(1) : $from.pos,
    to: $to.depth > 0 ? $to.after(1) : $to.pos,
  }
}

/**
 * Swaps the selected block range with its immediate sibling, including one-position leaf nodes.
 * The replace-around step maps positions inside the moved content. A translated selection bookmark
 * preserves selection kind, both endpoints, and direction instead of collapsing a range to a caret.
 */
function moveBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: 'up' | 'down'
): boolean {
  const block = currentTopLevelBlocks(state)
  if (!block) return false
  const { from, to } = block
  const up = direction === 'up'

  if (up ? from === 0 : to >= state.doc.content.size) return false
  const boundary = state.doc.resolve(up ? from : to)
  const sibling = up ? boundary.nodeBefore : boundary.nodeAfter
  if (!sibling) return false
  if (!dispatch) return true

  const spanFrom = up ? from - sibling.nodeSize : from
  const spanTo = up ? to : to + sibling.nodeSize
  const neighbour = up
    ? state.doc.slice(spanFrom, from).content
    : state.doc.slice(to, spanTo).content
  const tr = state.tr.step(
    new ReplaceAroundStep(
      spanFrom,
      spanTo,
      from,
      to,
      new Slice(neighbour, 0, 0),
      up ? 0 : neighbour.size
    )
  )
  const offset = up ? -sibling.nodeSize : sibling.nodeSize
  tr.setSelection(state.selection.getBookmark().map(StepMap.offset(offset)).resolve(tr.doc))
  dispatch(tr.scrollIntoView())
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockMover: {
      /** Move the selected top-level block range up one position, preserving the selection. */
      moveBlockUp: () => ReturnType
      /** Move the selected top-level block range down one position, preserving the selection. */
      moveBlockDown: () => ReturnType
    }
  }
}

/**
 * Reorders the selected top-level blocks with `Mod-Shift-ArrowUp`/`ArrowDown`, keeping their order
 * and selection. Returns false at document edges and for root gap cursors with no selected block.
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
