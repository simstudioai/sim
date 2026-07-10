import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import type { ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { MENTION_PLUGIN_KEY } from './mention'
import { SLASH_COMMAND_PLUGIN_KEY } from './slash-command/slash-command'

/** Leaf nodes that have no text position, so they can only be reached as a NodeSelection. */
const SELECTABLE_LEAVES = new Set(['horizontalRule', 'image'])

/**
 * Wrapper nodes whose empty child a boundary key must remove cleanly rather than lift. Lifting an empty
 * block out of one of these splits the container in two and strands an empty paragraph — a visible gap
 * that also fails to round-trip through markdown (see {@link removeEmptyWrappedBlock}).
 */
const WRAPPER_TYPES = new Set(['listItem', 'taskItem', 'blockquote'])

/** Item node types a list is built from, used to detect an empty item's position within its list. */
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem'])

/** True when the resolved position sits anywhere inside a {@link WRAPPER_TYPES} ancestor. */
function isInsideWrapper($from: ResolvedPos): boolean {
  for (let depth = $from.depth - 1; depth >= 1; depth--) {
    if (WRAPPER_TYPES.has($from.node(depth).type.name)) return true
  }
  return false
}

/**
 * Removes the empty textblock at `$from`, deleting up through the outermost ancestor it is the sole
 * child of, then places the caret at the end of the preceding block. This keeps a list or blockquote
 * whole when its middle/first/last item is emptied — where ProseMirror's default lift would split the
 * container and strand an empty paragraph (a visible gap, and markdown that re-parses to a different
 * document). Walking up while `childCount === 1` deletes the whole now-empty wrapper (the emptied list
 * item, not just its paragraph) so no orphan `<li>` or empty continuation line is left behind.
 */
function removeEmptyWrappedBlock(editor: Editor, $from: ResolvedPos): boolean {
  let depth = $from.depth
  while (depth > 1 && $from.node(depth - 1).childCount === 1) depth--
  const start = $from.before(depth)
  const end = $from.after(depth)
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      tr.delete(start, end)
      tr.setSelection(Selection.near(tr.doc.resolve(start), -1))
      dispatch(tr.scrollIntoView())
    }
    return true
  })
}

/**
 * True while a `/` or `@` suggestion menu is open. Arrow keys must reach that menu's own handler, so
 * the leaf-selection shortcuts below yield rather than stealing the key to select an adjacent divider.
 */
function isSuggestionMenuOpen(editor: Editor): boolean {
  const { state } = editor
  return (
    MENTION_PLUGIN_KEY.getState(state)?.active === true ||
    SLASH_COMMAND_PLUGIN_KEY.getState(state)?.active === true
  )
}

/**
 * Selects the leaf (divider/image) immediately across `boundary` in `direction`, or returns false if
 * the neighbour isn't a selectable leaf — the shared tail of both arrow handlers below.
 */
function selectLeafAcross(editor: Editor, boundary: number, direction: 'up' | 'down'): boolean {
  const resolved = editor.state.doc.resolve(boundary)
  const adjacent = direction === 'up' ? resolved.nodeBefore : resolved.nodeAfter
  if (!adjacent || !SELECTABLE_LEAVES.has(adjacent.type.name)) return false
  return editor.commands.setNodeSelection(
    direction === 'up' ? boundary - adjacent.nodeSize : boundary
  )
}

/**
 * Arrowing off the edge of a textblock toward an adjacent divider or image selects that node
 * (a NodeSelection), giving keyboard parity with clicking it. Without this the gap cursor swallows
 * the arrow and the node can never be selected — or deleted — from the keyboard.
 */
function selectAdjacentLeaf(editor: Editor, direction: 'up' | 'down'): boolean {
  const { selection } = editor.state
  if (!selection.empty || !editor.view.endOfTextblock(direction)) return false
  const { $from } = selection
  const boundary = direction === 'up' ? $from.before($from.depth) : $from.after($from.depth)
  return selectLeafAcross(editor, boundary, direction)
}

/**
 * When a divider/image is already selected, arrowing toward an immediately-adjacent divider/image
 * selects that one directly instead of stopping on the gap cursor between them — so stepping through a
 * run of dividers is one press each. A non-leaf neighbour (a textblock) falls through to the default,
 * which moves the caret into it.
 */
function selectAdjacentSelectedLeaf(editor: Editor, direction: 'up' | 'down'): boolean {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection) || !SELECTABLE_LEAVES.has(selection.node.type.name)) {
    return false
  }
  const boundary = direction === 'up' ? selection.from : selection.to
  return selectLeafAcross(editor, boundary, direction)
}

/**
 * Editor-specific keyboard behavior layered on top of StarterKit's defaults:
 *
 * - **Backspace** at the start of a heading reverts it to a paragraph (ProseMirror's default joins or
 *   no-ops, stranding the heading style; a second Backspace then merges as usual). At the start of an
 *   *empty block inside a list item, task item, or blockquote* it removes that whole emptied wrapper via
 *   {@link removeEmptyWrappedBlock} instead of ProseMirror's default lift — lifting an empty item out of
 *   the middle of a list/quote splits the container in two and strands an empty paragraph (a visible gap
 *   that also re-parses to a different markdown document), while the default `joinBackward` alternately
 *   no-ops on nested items (leaving them stuck) or merges an empty continuation paragraph into the
 *   previous item. At the start of a block whose previous sibling is a divider or image, where
 *   ProseMirror's `joinBackward` can't cross the leaf and no-ops: an *empty* block is deleted (clearing
 *   the blank line between/below dividers without touching the divider itself), while a *non-empty*
 *   block selects the leaf — so a first Backspace highlights what a second deletes, the same
 *   highlight-before-delete affordance as clicking it and parity with the arrow-key leaf selection.
 * - **Enter** on an *empty, non-trailing list/task item* removes the empty item ({@link
 *   removeEmptyWrappedBlock}) rather than letting the default split the list into two around a stranded
 *   empty paragraph (which does not round-trip). A *trailing* empty item still falls through to the
 *   default, which exits the list — the standard "press Enter on a blank bullet to leave the list".
 * - **Mod-A** inside a code block selects only that block's contents; pressing it again (when the
 *   block is already fully selected) falls through to the default whole-document select-all, the
 *   same scoped behavior as a code editor.
 * - **ArrowUp/ArrowDown** select an adjacent divider or image, whether arrowing off a textblock edge
 *   ({@link selectAdjacentLeaf}) or stepping from one already-selected leaf to the next
 *   ({@link selectAdjacentSelectedLeaf}). (The `Mod-Shift-Arrow` block-reorder chords live separately
 *   in `./block-mover.ts`.)
 *
 * Plus a plugin that (a) highlights dividers/images falling inside a range selection (e.g. select-all),
 * which the browser's native text highlight skips because leaves carry no text, and (b) flags the
 * editor (`data-gap-between-leaves`) while a gap cursor sits between two leaves, so the CSS can hide its
 * otherwise-stray caret.
 */
export const RichMarkdownKeymap = Extension.create({
  name: 'richMarkdownKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection, doc } = editor.state
        if (!selection.empty || selection.$from.parentOffset !== 0) return false
        const { $from } = selection
        if ($from.parent.type.name === 'heading') {
          return editor.commands.setParagraph()
        }
        if ($from.parent.content.size === 0 && isInsideWrapper($from)) {
          return removeEmptyWrappedBlock(editor, $from)
        }
        const blockStart = $from.before($from.depth)
        const nodeBefore = doc.resolve(blockStart).nodeBefore
        if (!nodeBefore || !SELECTABLE_LEAVES.has(nodeBefore.type.name)) return false
        const leafStart = blockStart - nodeBefore.nodeSize
        if ($from.parent.isTextblock && $from.parent.content.size === 0) {
          return editor.commands.command(({ tr, dispatch }) => {
            if (dispatch) {
              tr.delete(blockStart, $from.after($from.depth))
              tr.setSelection(NodeSelection.create(tr.doc, leafStart))
              dispatch(tr.scrollIntoView())
            }
            return true
          })
        }
        return editor.commands.setNodeSelection(leafStart)
      },
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty || selection.$from.parentOffset !== 0) return false
        const { $from } = selection
        if ($from.parent.content.size !== 0) return false
        const itemDepth = $from.depth - 1
        if (itemDepth < 1 || !LIST_ITEM_TYPES.has($from.node(itemDepth).type.name)) return false
        const listDepth = itemDepth - 1
        const isTrailingItem = $from.index(listDepth) === $from.node(listDepth).childCount - 1
        if (isTrailingItem) return false
        return removeEmptyWrappedBlock(editor, $from)
      },
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parent.type.name !== 'codeBlock') return false
        const from = $from.start($from.depth)
        const to = $from.end($from.depth)
        if (editor.state.selection.from === from && editor.state.selection.to === to) return false
        return editor.commands.setTextSelection({ from, to })
      },
      ArrowUp: ({ editor }) =>
        !isSuggestionMenuOpen(editor) &&
        (selectAdjacentSelectedLeaf(editor, 'up') || selectAdjacentLeaf(editor, 'up')),
      ArrowDown: ({ editor }) =>
        !isSuggestionMenuOpen(editor) &&
        (selectAdjacentSelectedLeaf(editor, 'down') || selectAdjacentLeaf(editor, 'down')),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('richLeafSelectionHighlight'),
        props: {
          decorations(state) {
            const { selection } = state
            if (selection.empty || selection instanceof NodeSelection) return null
            const decorations: Decoration[] = []
            state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
              if (SELECTABLE_LEAVES.has(node.type.name)) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'rich-leaf-in-selection' })
                )
              }
            })
            return decorations.length ? DecorationSet.create(state.doc, decorations) : null
          },
          attributes(state): Record<string, string> {
            const { selection } = state
            if (!(selection instanceof GapCursor)) return {}
            const before = selection.$head.nodeBefore
            const after = selection.$head.nodeAfter
            if (
              before &&
              after &&
              SELECTABLE_LEAVES.has(before.type.name) &&
              SELECTABLE_LEAVES.has(after.type.name)
            ) {
              return { 'data-gap-between-leaves': 'true' }
            }
            return {}
          },
        },
      }),
    ]
  },
})
