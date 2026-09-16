import Collaboration from '@tiptap/extension-collaboration'
import { NodeSelection, Plugin, Selection } from '@tiptap/pm/state'

/**
 * Yjs can resolve a restored node selection into text after a structural edit.
 * Normalize that invalid selection before ProseMirror renders or scrolls it.
 * @see https://github.com/ueberdosis/y-tiptap/blob/main/src/plugins/sync-plugin.js
 */
export const FileCollaboration = Collaboration.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        appendTransaction: (_transactions, _oldState, state) => {
          const { selection } = state
          if (selection instanceof NodeSelection && !NodeSelection.isSelectable(selection.node)) {
            return state.tr.setSelection(Selection.near(selection.$from))
          }
          return null
        },
      }),
    ]
  },
})
