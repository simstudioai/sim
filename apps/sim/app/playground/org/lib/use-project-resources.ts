import { useMemo } from 'react'
import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/file'
import { type Project, realWorkspaceId } from '@/app/playground/org/lib/project'
import { useFolderMap } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Every resource list a project page reads, from the workspace's own React Query hooks. */
export function useProjectResources(workspaceId: string) {
  /** Empty for a mock project: every query stays off and the lists read as empty. */
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

  const fileLists = useMemo(() => {
    const all = files.data ?? []
    return {
      files: all,
      dashboardFiles: all.filter((file) => file.type === DASHBOARD_CONTENT_TYPE),
    }
  }, [files.data])

  return {
    workflows: workflows.data ?? [],
    folders: folders.data ?? {},
    tables: tables.data ?? [],
    knowledgeBases: knowledgeBases.data ?? [],
    files: fileLists.files,
    dashboardFiles: fileLists.dashboardFiles,
    memberNames,
    isPending:
      enabled &&
      (workflows.isPending || tables.isPending || knowledgeBases.isPending || files.isPending),
    filesPending: enabled && files.isPending,
  }
}

export type ProjectResources = ReturnType<typeof useProjectResources>

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The pack's purpose line when the pack was chosen for this project; otherwise what the workspace holds. */
export function useProjectDescription(project: Project): string {
  const { workflows, tables, knowledgeBases, files, isPending } = useProjectResources(
    realWorkspaceId(project)
  )
  if (project.overlayMatched) return project.mock.description
  if (isPending) return ''
  return [
    plural(workflows.length, 'workflow'),
    plural(tables.length, 'table'),
    plural(knowledgeBases.length, 'knowledge base'),
    plural(files.length, 'file'),
  ].join(' · ')
}
