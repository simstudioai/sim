'use client'

import { useCallback } from 'react'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useRenameProject } from '@/hooks/queries/projects'
import {
  useDeleteWorkspace,
  usePinnedWorkspaceIds,
  useToggleWorkspacePin,
} from '@/hooks/queries/workspace'

/**
 * Rename, pin and delete for a project: a rename changes the project's own name, a delete
 * removes its workspaces forks first, and the pin lives on its root workspace.
 */
export function useProjectActions() {
  const { data: pinnedIds } = usePinnedWorkspaceIds()
  const { mutate: togglePin } = useToggleWorkspacePin()
  const { mutateAsync: renameProject, isPending: isRenaming } = useRenameProject()
  const { mutateAsync: deleteWorkspace, isPending: isDeleting } = useDeleteWorkspace()

  const isPinned = useCallback(
    (project: Project) => Boolean(pinnedIds?.has(project.rootId)),
    [pinnedIds]
  )

  const setPinned = useCallback(
    (project: Project, pinned: boolean) => {
      togglePin({ workspaceId: project.rootId, pinned })
    },
    [togglePin]
  )

  const rename = useCallback(
    async (project: Project, name: string) => {
      const next = name.trim()
      if (!next || next === project.name) return
      await renameProject({ projectId: project.projectId, name: next })
    },
    [renameProject]
  )

  const remove = useCallback(
    async (project: Project) => {
      /** Forks first: the root is the last workspace to go, so a failure leaves a valid lineage. */
      for (const environment of [...project.environments].reverse()) {
        await deleteWorkspace({ workspaceId: environment.workspaceId })
      }
    },
    [deleteWorkspace]
  )

  return { isPinned, setPinned, rename, remove, isRenaming, isDeleting }
}
