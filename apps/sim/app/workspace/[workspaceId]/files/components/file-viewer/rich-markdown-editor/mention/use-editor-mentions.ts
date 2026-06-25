import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useMarkdownMentions } from './use-markdown-mentions'

/**
 * Wires an editor's `@` mention menu to its workspace data: gates the menu on a workspace scope,
 * lazily fetches the data on the first open, and feeds it into the menu's reactive store. Shared by
 * every editor surface that mounts the mention extension (the file editor and the modal field).
 */
export function useEditorMentions(editor: Editor | null, workspaceId: string | undefined): void {
  const [active, setActive] = useState(false)
  const items = useMarkdownMentions(workspaceId, { enabled: active })

  useEffect(() => {
    if (!editor) return
    const hasWorkspace = Boolean(workspaceId)
    editor.storage.mention.enabled = hasWorkspace
    editor.storage.mention.onOpen = hasWorkspace ? () => setActive(true) : null
    return () => {
      editor.storage.mention.onOpen = null
    }
  }, [editor, workspaceId])

  useEffect(() => {
    editor?.storage.mention.store.set(items)
  }, [editor, items])
}
