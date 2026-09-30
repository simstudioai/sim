import { useMemo } from 'react'
import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/file'
import type { Project } from '@/app/playground/org/lib/project'
import { useFolderMap } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Every resource list a project page reads, from the workspace's own React Query hooks. */
export function useProjectResources(workspaceId: string) {
  const workflows = useWorkflows(workspaceId)
  const folders = useFolderMap(workspaceId)
  const tables = useTablesList(workspaceId)
  const knowledgeBases = useKnowledgeBasesQuery(workspaceId, { includeCounts: true })
  const files = useWorkspaceFiles(workspaceId)
  const members = useWorkspaceMembersQuery(workspaceId)

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
      workflows.isPending || tables.isPending || knowledgeBases.isPending || files.isPending,
    filesPending: files.isPending,
  }
}

export type ProjectResources = ReturnType<typeof useProjectResources>

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The pack's purpose line when the pack was chosen for this project; otherwise what the workspace holds. */
export function useProjectDescription(project: Project): string {
  const { workflows, tables, knowledgeBases, files, isPending } = useProjectResources(project.id)
  if (project.overlayMatched) return project.mock.description
  if (isPending) return ''
  return [
    plural(workflows.length, 'workflow'),
    plural(tables.length, 'table'),
    plural(knowledgeBases.length, 'knowledge base'),
    plural(files.length, 'file'),
  ].join(' · ')
}
