import { useMemo } from 'react'
import type { ListProjectFilesResponse } from '@/lib/api/contracts/project-files'
import type { Project } from '@/lib/api/contracts/projects'
import type { AvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useProjectFileInventories, useProjectFileInventory } from '@/hooks/queries/project-files'

function projectResources(
  project: Pick<Project, 'id' | 'name'>,
  items: ListProjectFilesResponse['items'] | undefined,
  isHydrating: boolean
): AvailableResources {
  const files: AvailableResources['groups'][number]['items'] = []
  const folders: AvailableResources['structureFolders']['file'] = []
  const owner = { entityType: 'project', entityId: project.id } as const
  for (const item of items ?? []) {
    if (item.kind === 'file') {
      files.push({
        id: item.id,
        name: item.name,
        folderId: item.parentId,
        owner,
        projectName: project.name,
      })
    } else {
      folders.push({
        id: item.id,
        name: item.name,
        parentId: item.parentId,
        owner,
        selectable: false,
      })
    }
  }
  return {
    groups: [{ type: 'file', items: files }],
    structureFolders: { table: [], knowledgebase: [], file: folders },
    isHydrating,
  }
}

/** Project resources retain their owner independently of any environment. */
export function useAvailableProjectResources(
  project: Pick<Project, 'id' | 'name'>,
  enabled = true
) {
  const projectFilesEnabled = useFeatureFlag('project-files')
  const active = enabled && projectFilesEnabled
  const query = useProjectFileInventory(project.id, active)
  const items = active && !query.isError ? query.data : undefined
  const isHydrating = active && query.isPending
  return useMemo(
    () => projectResources({ id: project.id, name: project.name }, items, isHydrating),
    [items, project.id, project.name, isHydrating]
  )
}

/** Derives current Project inventories directly from their query observers. */
export function useAvailableProjectInventories(
  projects: ReadonlyArray<Pick<Project, 'id' | 'name'>>,
  enabled: boolean
): Record<string, AvailableResources> {
  const projectFilesEnabled = useFeatureFlag('project-files')
  const active = enabled && projectFilesEnabled
  const queries = useProjectFileInventories(
    projects.map((project) => project.id),
    active
  )
  const inventories: Record<string, AvailableResources> = {}
  for (const [index, project] of projects.entries()) {
    const query = queries[index]
    inventories[project.id] = projectResources(
      project,
      active && query && !query.isError ? query.data : undefined,
      active && (query?.isPending ?? true)
    )
  }
  return inventories
}
