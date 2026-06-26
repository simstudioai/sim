import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { MENTION_PLUGIN_KEY } from './mention'
import { SLASH_COMMAND_PLUGIN_KEY } from './slash-command/slash-command'

/** Leaf nodes that have no text position, so they can only be reached as a NodeSelection. */
const SELECTABLE_LEAVES = new Set(['horizontalRule', 'image'])

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
 * Arrowing off the edge of a textblock toward an adjacent divider or image selects that node
 * (a NodeSelection), giving keyboard parity with clicking it. Without this the gap cursor swallows
 * the arrow and the node can never be selected — or deleted — from the keyboard.
 */
function selectAdjacentLeaf(editor: Editor, direction: 'up' | 'down'): boolean {
  const { selection } = editor.state
  if (!selection.empty || !editor.view.endOfTextblock(direction)) return false
  const { $from } = selection
  const boundary = direction === 'up' ? $from.before($from.depth) : $from.after($from.depth)
  const resolved = editor.state.doc.resolve(boundary)
  const adjacent = direction === 'up' ? resolved.nodeBefore : resolved.nodeAfter
  if (!adjacent || !SELECTABLE_LEAVES.has(adjacent.type.name)) return false
  return editor.commands.setNodeSelection(
    direction === 'up' ? boundary - adjacent.nodeSize : boundary
  )
}

/**
 * Editor-specific keyboard behavior layered on top of StarterKit's defaults:
 *
 * - **Backspace** at the start of a heading reverts it to a paragraph (ProseMirror's default joins or
 *   no-ops, stranding the heading style; a second Backspace then merges as usual); at the start of a
 *   block whose previous sibling is a horizontal rule it deletes the rule (ProseMirror's default
 *   `joinBackward` can't cross a leaf node, so without this pressing Backspace below a divider is a
 *   confusing no-op).
 * - **Mod-A** inside a code block selects only that block's contents; pressing it again (when the
 *   block is already fully selected) falls through to the default whole-document select-all, the
 *   same scoped behavior as a code editor.
 * - **ArrowUp/ArrowDown** select an adjacent divider or image (see {@link selectAdjacentLeaf}).
 */
export const RichMarkdownKeymap = Extension.create({
  name: 'richMarkdownKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection, doc } = editor.state
        if (!selection.empty || selection.$from.parentOffset !== 0) return false
        if (selection.$from.parent.type.name === 'heading') {
          return editor.commands.setParagraph()
        }
        const blockStart = selection.$from.before(selection.$from.depth)
        const nodeBefore = doc.resolve(blockStart).nodeBefore
        if (nodeBefore?.type.name !== 'horizontalRule') return false
        return editor.commands.command(({ tr }) => {
          tr.delete(blockStart - nodeBefore.nodeSize, blockStart)
          return true
        })
      },
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parent.type.name !== 'codeBlock') return false
        const from = $from.start($from.depth)
        const to = $from.end($from.depth)
        if (editor.state.selection.from === from && editor.state.selection.to === to) return false
        return editor.commands.setTextSelection({ from, to })
      },
      ArrowUp: ({ editor }) => !isSuggestionMenuOpen(editor) && selectAdjacentLeaf(editor, 'up'),
      ArrowDown: ({ editor }) =>
        !isSuggestionMenuOpen(editor) && selectAdjacentLeaf(editor, 'down'),
    }
  },
})
