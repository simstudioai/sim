import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useMarkdownMentions } from './use-markdown-mentions'

interface UseEditorMentionsOptions {
  /** Whether a chip can Cmd/Ctrl-click to its resource. On for the file viewer, off in modal fields. */
  navigable?: boolean
  /** Force the `@` insertion menu off even with a workspace; existing tags still render. */
  disableTagging?: boolean
}

/**
 * Wires an editor's `@` mention menu to its workspace data: gates the menu on a workspace scope,
 * lazily fetches the data on the first open, and feeds it into the menu's reactive store. Shared by
 * every editor surface that mounts the mention extension (the file editor and the modal field).
 */
export function useEditorMentions(
  editor: Editor | null,
  workspaceId: string | undefined,
  options?: UseEditorMentionsOptions
): void {
  const [active, setActive] = useState(false)
  const items = useMarkdownMentions(workspaceId, { enabled: active })
  const navigable = options?.navigable ?? false
  const disableTagging = options?.disableTagging ?? false

  useEffect(() => {
    if (!editor) return
    const taggingOn = Boolean(workspaceId) && !disableTagging
    editor.storage.mention.enabled = taggingOn
    editor.storage.mention.navigable = navigable
    editor.storage.mention.onOpen = taggingOn ? () => setActive(true) : null
    return () => {
      editor.storage.mention.onOpen = null
    }
  }, [editor, workspaceId, navigable, disableTagging])

  useEffect(() => {
    editor?.storage.mention.store.set(items)
  }, [editor, items])
}
