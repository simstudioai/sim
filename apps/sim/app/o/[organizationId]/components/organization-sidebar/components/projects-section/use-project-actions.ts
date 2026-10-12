'use client'

import { useCallback } from 'react'
import { isProjectPinned } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { defaultEnvironment, type Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useArchiveProject, useRenameProject } from '@/hooks/queries/projects'
import { usePinnedWorkspaceIds, useToggleWorkspacePin } from '@/hooks/queries/workspace'

/**
 * Rename, pin and delete for a project. Rename and delete act on the project itself; delete
 * archives it with every environment. Pins live on workspaces, so pinning pins the project's
 * default environment and unpinning clears every environment's pin.
 */
export function useProjectActions() {
  const { data: pinnedIds } = usePinnedWorkspaceIds()
  const { mutate: togglePin } = useToggleWorkspacePin()
  const { mutateAsync: renameProject, isPending: isRenaming } = useRenameProject()
  const { mutateAsync: archiveProject, isPending: isDeleting } = useArchiveProject()

  const isPinned = useCallback(
    (project: Project) => isProjectPinned(project, pinnedIds),
    [pinnedIds]
  )

  const setPinned = useCallback(
    (project: Project, pinned: boolean) => {
      if (pinned) {
        togglePin({ workspaceId: defaultEnvironment(project).workspaceId, pinned })
        return
      }
      for (const environment of project.environments) {
        if (pinnedIds?.has(environment.workspaceId))
          togglePin({ workspaceId: environment.workspaceId, pinned })
      }
    },
    [togglePin, pinnedIds]
  )

  const rename = useCallback(
    async (project: Project, name: string) => {
      const trimmed = name.trim()
      if (!trimmed || trimmed === project.name) return
      await renameProject({ projectId: project.id, name: trimmed })
    },
    [renameProject]
  )

  const remove = useCallback(
    async (project: Project) => {
      await archiveProject({ projectId: project.id })
    },
    [archiveProject]
  )

  return { isPinned, setPinned, rename, remove, isRenaming, isDeleting }
}
