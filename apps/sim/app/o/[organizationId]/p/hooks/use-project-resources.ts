import { useMemo } from 'react'
import { useFolderMap } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Every resource list a project page reads, from the workspace's own React Query hooks. */
export function useProjectResources(workspaceId: string) {
  const enabled = Boolean(workspaceId)
  const workflows = useWorkflows(workspaceId || undefined, { enabled })
  const folders = useFolderMap(workspaceId || undefined)
  const tables = useTablesList(workspaceId || undefined, 'active', { enabled })
  const knowledgeBases = useKnowledgeBasesQuery(workspaceId || undefined, {
    includeCounts: true,
    enabled,
  })
  const files = useWorkspaceFiles(workspaceId, 'active', { enabled })
  const members = useWorkspaceMembersQuery(workspaceId || undefined)

  const memberNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const member of members.data ?? []) names.set(member.userId, member.name)
    return names
  }, [members.data])

  return {
    workflows: workflows.data ?? [],
    folders: folders.data ?? {},
    tables: tables.data ?? [],
    knowledgeBases: knowledgeBases.data ?? [],
    files: files.data ?? [],
    memberNames,
    isPending:
      enabled &&
      (workflows.isPending || tables.isPending || knowledgeBases.isPending || files.isPending),
    filesPending: enabled && files.isPending,
  }
}

export type ProjectResources = ReturnType<typeof useProjectResources>
