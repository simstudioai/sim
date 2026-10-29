import { useMemo } from 'react'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { listIntegrations } from '@/blocks/integration-matcher'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useSkills } from '@/hooks/queries/skills'
import { useTablesList } from '@/hooks/queries/tables'
import { workspaceFileListParams } from '@/hooks/queries/utils/workspace-file-keys'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFileList, useWorkspaceFileSearch } from '@/hooks/queries/workspace-files'
import { useDebounce } from '@/hooks/use-debounce'
import { mentionIcon } from './mention-icon'
import type { MentionItem } from './types'

/** The files the menu offers before anything is typed: the most recently updated anywhere. */
const RECENT_FILES = workspaceFileListParams({ sortBy: 'updatedAt', sortOrder: 'desc', limit: 50 })

const FILE_SEARCH_LIMIT = 50

/**
 * Aggregates the workspace-scoped entities the `@` menu can reference, composing the canonical
 * per-resource React Query hooks (never the chat-coupled `useAvailableResources` aggregator). All
 * queries stay disabled until `enabled` flips true — the host activates it on the first `@` trigger —
 * so a markdown field that never opens the menu fetches nothing.
 *
 * Files are the one family not listed whole: the menu offers the most recently updated, and once
 * `fileQuery` (the text after the `@`) settles, the files whose names match it anywhere.
 */
export function useMarkdownMentions(
  workspaceId: string | undefined,
  options: { enabled: boolean; fileQuery?: string }
): MentionItem[] {
  const active = options.enabled && Boolean(workspaceId)
  // When inactive, `ws` is undefined and `wsStr` is '' so every query stays disabled until the first
  // `@`: the hooks that expose an `enabled` option get it explicitly; the rest (which take no options)
  // self-gate internally on the falsy workspaceId — both empty string and undefined read as disabled.
  const ws = active ? workspaceId : undefined
  const wsStr = ws ?? ''

  const fileQuery = useDebounce(options.fileQuery?.trim() ?? '', SEARCH_DEBOUNCE_MS)
  const recentFiles = useWorkspaceFileList(wsStr, RECENT_FILES, { enabled: active })
  const matchingFiles = useWorkspaceFileSearch(
    wsStr,
    { q: fileQuery, limit: FILE_SEARCH_LIMIT },
    { enabled: active }
  )
  const files = fileQuery ? matchingFiles.data : recentFiles.data?.pages[0]?.files
  const folders = useWorkspaceFileFolders(wsStr, 'active')
  const tables = useTablesList(ws, 'active')
  const knowledgeBases = useKnowledgeBasesQuery(ws, { enabled: active })
  const workflows = useWorkflows(ws)
  const skills = useSkills(wsStr)

  // The integration registry is static — materialize it once rather than on every resource refetch.
  const integrationItems = useMemo<MentionItem[]>(() => {
    if (!active) return []
    return listIntegrations().map((integration) => ({
      kind: 'integration',
      id: integration.blockType,
      label: integration.name,
      group: 'Integrations',
      icon: mentionIcon('integration', integration.blockType),
    }))
  }, [active])

  return useMemo(() => {
    if (!active) return []
    const items: MentionItem[] = []

    for (const file of files ?? [])
      items.push({
        kind: 'file',
        id: file.id,
        label: file.name,
        group: 'Files',
        icon: mentionIcon('file', file.id, file.name),
      })
    for (const folder of folders.data ?? [])
      items.push({
        kind: 'folder',
        id: folder.id,
        label: folder.name,
        group: 'Folders',
        icon: mentionIcon('folder', folder.id),
      })
    for (const table of tables.data ?? [])
      items.push({
        kind: 'table',
        id: table.id,
        label: table.name,
        group: 'Tables',
        icon: mentionIcon('table', table.id),
      })
    for (const kb of knowledgeBases.data ?? [])
      items.push({
        kind: 'knowledge',
        id: kb.id,
        label: kb.name,
        group: 'Knowledge bases',
        icon: mentionIcon('knowledge', kb.id),
      })
    for (const workflow of workflows.data ?? [])
      items.push({
        kind: 'workflow',
        id: workflow.id,
        label: workflow.name,
        group: 'Workflows',
        icon: mentionIcon('workflow', workflow.id),
      })
    for (const skill of skills.data ?? [])
      items.push({
        kind: 'skill',
        id: skill.id,
        label: skill.name,
        group: 'Skills',
        icon: mentionIcon('skill', skill.id),
      })
    items.push(...integrationItems)

    return items
  }, [
    active,
    files,
    folders.data,
    tables.data,
    knowledgeBases.data,
    workflows.data,
    skills.data,
    integrationItems,
  ])
}
