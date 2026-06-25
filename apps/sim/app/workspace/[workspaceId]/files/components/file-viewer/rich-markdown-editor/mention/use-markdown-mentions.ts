import { useMemo } from 'react'
import { Database, File, Folder, Sparkles, Table, Workflow } from 'lucide-react'
import { listIntegrations } from '@/blocks/integration-matcher'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useSkills } from '@/hooks/queries/skills'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import type { MentionItem } from './types'

/**
 * Aggregates the workspace-scoped entities the `@` menu can reference, composing the canonical
 * per-resource React Query hooks (never the chat-coupled `useAvailableResources` aggregator). All
 * queries stay disabled until `enabled` flips true — the host activates it on the first `@` trigger —
 * so a markdown field that never opens the menu fetches nothing.
 */
export function useMarkdownMentions(
  workspaceId: string | undefined,
  options: { enabled: boolean }
): MentionItem[] {
  const active = options.enabled && Boolean(workspaceId)
  // Pass through only when active; each hook self-gates on a falsy workspaceId.
  const ws = active ? workspaceId : undefined
  const wsStr = ws ?? ''

  const files = useWorkspaceFiles(wsStr, 'active', { enabled: active })
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
      icon: integration.icon,
    }))
  }, [active])

  return useMemo(() => {
    if (!active) return []
    const items: MentionItem[] = []

    for (const file of files.data ?? [])
      items.push({ kind: 'file', id: file.id, label: file.name, group: 'Files', icon: File })
    for (const folder of folders.data ?? [])
      items.push({
        kind: 'folder',
        id: folder.id,
        label: folder.name,
        group: 'Folders',
        icon: Folder,
      })
    for (const table of tables.data ?? [])
      items.push({ kind: 'table', id: table.id, label: table.name, group: 'Tables', icon: Table })
    for (const kb of knowledgeBases.data ?? [])
      items.push({
        kind: 'knowledge',
        id: kb.id,
        label: kb.name,
        group: 'Knowledge bases',
        icon: Database,
      })
    for (const workflow of workflows.data ?? [])
      items.push({
        kind: 'workflow',
        id: workflow.id,
        label: workflow.name,
        group: 'Workflows',
        icon: Workflow,
      })
    for (const skill of skills.data ?? [])
      items.push({
        kind: 'skill',
        id: skill.id,
        label: skill.name,
        group: 'Skills',
        icon: Sparkles,
      })
    items.push(...integrationItems)

    return items
  }, [
    active,
    files.data,
    folders.data,
    tables.data,
    knowledgeBases.data,
    workflows.data,
    skills.data,
    integrationItems,
  ])
}
