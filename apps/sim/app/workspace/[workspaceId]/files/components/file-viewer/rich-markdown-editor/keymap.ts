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

/** The enclosing list/task item at a caret position, with the facts the boundary keys branch on. */
interface ListItemContext {
  /** `'listItem'` or `'taskItem'` — the type name `liftListItem` must be called with. */
  itemType: string
  /** The item's list is itself inside another list item, i.e. the item is indented. */
  isNested: boolean
  /** The item carries no text. */
  isEmpty: boolean
  /** The item is the last child of its immediate list. */
  isTrailing: boolean
  /** The caret sits in the item's first child block (the row a boundary key should act on). */
  isFirstBlock: boolean
}

/**
 * Resolves the nearest enclosing list/task item at `$from` and the facts the Backspace/Enter handlers
 * branch on (nesting, emptiness, trailing position, whether the caret is in the item's first block), or
 * null when the caret is not inside a list item. Walking up from `$from` finds the item regardless of
 * how deeply the caret's block is nested inside it.
 */
function getListItemContext($from: ResolvedPos): ListItemContext | null {
  for (let depth = $from.depth; depth >= 1; depth--) {
    const item = $from.node(depth)
    if (!LIST_ITEM_TYPES.has(item.type.name)) continue
    const listDepth = depth - 1
    const isNested = listDepth >= 1 && LIST_ITEM_TYPES.has($from.node(listDepth - 1).type.name)
    const list = $from.node(listDepth)
    return {
      itemType: item.type.name,
      isNested,
      isEmpty: item.textContent.length === 0,
      isTrailing: $from.index(listDepth) === list.childCount - 1,
      isFirstBlock: $from.index(depth) === 0,
    }
  }
  return null
}

const RICH_LEAF_SELECTION_FOCUS_KEY = new PluginKey<boolean>('richLeafSelectionFocus')

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
 *
 * The selection left behind must be a CARET, never a NodeSelection: `Selection.near` can silently
 * land a NodeSelection on an adjacent leaf (deleting the sole bullet at the top of a doc whose next
 * block is an image selected that image), turning the user's next keystroke destructive — a second
 * Backspace while "clearing the bullet" deleted the image, and typing would have replaced it. So:
 * end of the previous textblock first; else a gap cursor at the deletion point when the neighbour is
 * a leaf (typing there inserts a new block where the emptied one was, instead of replacing the leaf);
 * else the next textblock.
 */
function removeEmptyWrappedBlock(editor: Editor, $from: ResolvedPos): boolean {
  let depth = $from.depth
  while (depth > 1 && $from.node(depth - 1).childCount === 1) depth--
  const start = $from.before(depth)
  const end = $from.after(depth)
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      tr.delete(start, end)
      const $gap = tr.doc.resolve(start)
      tr.setSelection(
        Selection.findFrom($gap, -1, true) ??
          (isLeafGap($gap) ? new GapCursor($gap) : null) ??
          Selection.findFrom($gap, 1, true) ??
          Selection.near($gap, -1)
      )
      dispatch(tr.scrollIntoView())
    }
    return true
  })
}

/**
 * True when `$pos` is a block boundary a gap cursor is valid at in this schema: the following node is
 * a selectable leaf (divider/image) and there is nothing before it, or another leaf — i.e. no textblock
 * on either side for a normal caret to land in.
 */
function isLeafGap($pos: ResolvedPos): boolean {
  const after = $pos.nodeAfter
  if (!after || !SELECTABLE_LEAVES.has(after.type.name)) return false
  const before = $pos.nodeBefore
  return !before || SELECTABLE_LEAVES.has(before.type.name)
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
 *   no-ops, stranding the heading style; a second Backspace then merges as usual). At the start of a
 *   *list or task item* it outdents or clears in place via {@link getListItemContext}: a nested item outdents one
 *   level, a top-level item with text lifts out of the list into a paragraph (keeping the text), and a
 *   top-level *empty trailing* (or sole) item lifts into an empty paragraph in place — so the blank
 *   bullet made by pressing Enter can be cleared back to normal text on the same line instead of being
 *   deleted with the caret jumping to the previous block. The one case lift can't take is a top-level
 *   *empty, non-trailing* item: lifting it strands an empty paragraph between the two list halves, which
 *   re-parses to a different markdown document (an empty line between list items is a loose list, not a
 *   break); that item is removed via {@link removeEmptyWrappedBlock} instead, keeping the list whole. An
 *   empty block inside a *blockquote* is likewise removed via {@link removeEmptyWrappedBlock}. At the
 *   start of a block whose previous sibling is a divider or image, where ProseMirror's `joinBackward`
 *   can't cross the leaf and no-ops: an *empty* block is deleted (clearing the blank line between/below
 *   dividers without touching the divider itself), while a *non-empty* block selects the leaf — so a
 *   first Backspace highlights what a second deletes, the same highlight-before-delete affordance as
 *   clicking it and parity with the arrow-key leaf selection.
 * - **Enter** on an empty *nested* list/task item outdents it one level, on an empty
 *   *non-trailing top-level* item removes it ({@link removeEmptyWrappedBlock}) rather than splitting the
 *   list around a stranded empty paragraph (which does not round-trip), and on an empty *trailing* item
 *   falls through to the default, which exits the list — the standard "press Enter on a blank bullet to
 *   leave the list".
 * - **Mod-A** inside a code block selects only that block's contents; pressing it again (when the
 *   block is already fully selected) falls through to the default whole-document select-all, the
 *   same scoped behavior as a code editor.
 * - **ArrowUp/ArrowDown** select an adjacent divider or image, whether arrowing off a textblock edge
 *   ({@link selectAdjacentLeaf}) or stepping from one already-selected leaf to the next
 *   ({@link selectAdjacentSelectedLeaf}). (The `Mod-Shift-Arrow` block-reorder chords live separately
 *   in `./block-mover.ts`.)
 *
 * Plus a plugin that (a) highlights dividers/images falling inside a focused range selection (e.g.
 * select-all), which the browser's native text highlight skips because leaves carry no text; hiding
 * that custom decoration on blur keeps it in sync with the native text highlight, and (b) flags the
 * editor (`data-gap-between-leaves`) while a gap cursor sits between two leaves, so the CSS can hide
 * its otherwise-stray caret.
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
        // A gap cursor at the start of the doc resolves at the top level (`depth === 0`, offset 0):
        // `$from.before(0)` below throws, and falling through instead is no better — TipTap's
        // blockquote Backspace handler crashes on the same resolution (`$from.node(-1)` is
        // undefined). There is nothing before the gap for Backspace to act on, so consume the key.
        if ($from.depth === 0) return true
        if ($from.parent.type.name === 'heading') {
          return editor.commands.setParagraph()
        }
        const listCtx = getListItemContext($from)
        if (listCtx?.isFirstBlock) {
          const { itemType, isNested, isEmpty, isTrailing } = listCtx
          // Backspace at the start of a bullet outdents or clears it in place rather than
          // deleting the row and jumping the caret to the previous block.
          // - Nested item → outdent one level (empty or not).
          // - Top-level item with text → lift out of the list into a paragraph, keeping the text.
          // - Top-level empty item that is trailing (or the sole item) → lift into an empty paragraph in
          //   place, so a fresh bullet made with Enter can be cleared back to normal text on the same line.
          // A top-level *empty, non-trailing* item is the one case lift can't take: it strands an empty
          // paragraph between the two list halves, which re-parses to a different markdown document (an
          // empty line between list items is a loose list, not a break). That case removes the row via
          // {@link removeEmptyWrappedBlock} instead, which keeps the list whole and round-trips.
          if (isNested || !isEmpty || isTrailing) {
            return editor.commands.liftListItem(itemType)
          }
          return removeEmptyWrappedBlock(editor, $from)
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
        const listCtx = getListItemContext($from)
        if (!listCtx?.isFirstBlock) return false
        // Enter on an empty item: a nested item outdents one level, a trailing top-level item
        // falls through to the default (exits the list), and a non-trailing top-level item is removed
        // rather than splitting the list around a stranded empty paragraph (which does not round-trip).
        if (listCtx.isNested) return editor.commands.liftListItem(listCtx.itemType)
        if (listCtx.isTrailing) return false
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
        key: RICH_LEAF_SELECTION_FOCUS_KEY,
        state: {
          init: () => false,
          apply(transaction, focused) {
            const nextFocused = transaction.getMeta(RICH_LEAF_SELECTION_FOCUS_KEY)
            return typeof nextFocused === 'boolean' ? nextFocused : focused
          },
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(RICH_LEAF_SELECTION_FOCUS_KEY, true))
              return false
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(RICH_LEAF_SELECTION_FOCUS_KEY, false))
              return false
            },
          },
          decorations(state) {
            const { selection } = state
            if (
              RICH_LEAF_SELECTION_FOCUS_KEY.getState(state) !== true ||
              selection.empty ||
              selection instanceof NodeSelection
            ) {
              return null
            }
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
