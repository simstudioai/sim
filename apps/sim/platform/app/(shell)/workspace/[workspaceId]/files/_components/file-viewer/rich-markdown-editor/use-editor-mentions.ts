'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { INTEGRATION_MENTIONS } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/mention-items'
import {
  getWorkflowListQueryOptions,
  type MentionItem,
  type MentionMenuData,
  useKnowledgeBasesQuery,
  useSkills,
  useTablesList,
  useWorkspaceFileFolders,
  useWorkspaceFilePickerOptions,
} from '@/platform/lib/data/files/markdown'

const NO_ITEMS: MentionItem[] = []

/**
 * The workspace entities the `@` menu offers, from each resource's own query. Nothing is fetched
 * until the menu first opens. Files are not listed whole: the most recent, then the server's
 * matches for what is typed after the `@`.
 */
function useMentionItems(workspaceId: string, active: boolean, fileQuery: string): MentionMenuData {
  const ws = active ? workspaceId : undefined
  const wsStr = ws ?? ''
  const {
    files,
    matchedQuery,
    isPending: filesPending,
  } = useWorkspaceFilePickerOptions(wsStr, fileQuery, { enabled: active })
  const folders = useWorkspaceFileFolders(wsStr, 'active')
  const tables = useTablesList(ws, 'active')
  const knowledgeBases = useKnowledgeBasesQuery(ws, { enabled: active })
  const workflows = useQuery({ ...getWorkflowListQueryOptions(wsStr), enabled: active })
  const skills = useSkills(wsStr)
  const items = useMemo(() => {
    if (!active) return NO_ITEMS
    const next: MentionItem[] = []
    for (const file of files ?? [])
      next.push({
        kind: 'file',
        id: file.id,
        label: file.name,
        group: 'Files',
        ...(matchedQuery ? { matchedQuery } : {}),
      })
    for (const folder of folders.data ?? [])
      next.push({ kind: 'folder', id: folder.id, label: folder.name, group: 'Folders' })
    for (const table of tables.data ?? [])
      next.push({ kind: 'table', id: table.id, label: table.name, group: 'Tables' })
    for (const kb of knowledgeBases.data ?? [])
      next.push({ kind: 'knowledge', id: kb.id, label: kb.name, group: 'Knowledge bases' })
    for (const workflow of workflows.data ?? [])
      next.push({ kind: 'workflow', id: workflow.id, label: workflow.name, group: 'Workflows' })
    for (const skill of skills.data ?? [])
      next.push({ kind: 'skill', id: skill.id, label: skill.name, group: 'Skills' })
    next.push(...INTEGRATION_MENTIONS)
    return next
  }, [
    active,
    files,
    matchedQuery,
    folders.data,
    tables.data,
    knowledgeBases.data,
    workflows.data,
    skills.data,
  ])
  const pending = active && filesPending
  return useMemo(() => ({ items, filesPending: pending }), [items, pending])
}

/**
 * Wires an editor's `@` menu to its workspace: the menu opens only with a workspace, fetches on its
 * first open, searches files by the typed query and feeds the menu's store. `navigable` lets a chip
 * Cmd/Ctrl-click through to its resource.
 */
export function useEditorMentions(editor: Editor | null, workspaceId: string): void {
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState('')
  const menu = useMentionItems(workspaceId, active, query)

  useEffect(() => {
    if (!editor) return
    const storage = editor.storage.mentionMenu
    storage.enabled = Boolean(workspaceId)
    storage.navigable = true
    storage.onOpen = workspaceId ? () => setActive(true) : null
    storage.onQuery = workspaceId ? setQuery : null
    return () => {
      storage.onOpen = null
      storage.onQuery = null
    }
  }, [editor, workspaceId])

  useEffect(() => {
    editor?.storage.mentionMenu.store.set(menu)
  }, [editor, menu])
}
