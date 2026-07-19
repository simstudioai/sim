import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

/**
 * Reactively tracks `editor.isEditable` for React node views.
 *
 * The editor runs with `shouldRerenderOnTransaction: false`, and `editor.setEditable()` updates the
 * option + re-applies view state but does NOT change any node-view prop — so a node view that reads
 * `editor.isEditable` once at render keeps a stale value after the editability toggles (e.g. an agent
 * stream settling into the doc). That leaves images showing no drag/resize/selection affordances and
 * code blocks stuck on their read-only label until the node happens to re-render. Subscribing to the
 * editor's `transaction`/`update` events re-reads the flag so the node view stays in sync.
 */
export function useEditorEditable(editor: Editor): boolean {
  const [editable, setEditable] = useState(editor.isEditable)
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable)
    sync()
    editor.on('transaction', sync)
    editor.on('update', sync)
    return () => {
      editor.off('transaction', sync)
      editor.off('update', sync)
    }
  }, [editor])
  return editable
}
