import { useMemo } from 'react'
import type { ProjectScope } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useFolderMap } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Every resource list a project page reads, from the workspace's own React Query hooks. */
function useProjectResources(workspaceId: string) {
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
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** What the project's workspace holds, as its description line. */
export function useProjectDescription(project: ProjectScope): string {
  const { workflows, tables, knowledgeBases, files, isPending } = useProjectResources(
    project.workspaceId
  )
  if (isPending) return ''
  return [
    plural(workflows.length, 'workflow'),
    plural(tables.length, 'table'),
    plural(knowledgeBases.length, 'knowledge base'),
    plural(files.length, 'file'),
  ].join(' · ')
}
