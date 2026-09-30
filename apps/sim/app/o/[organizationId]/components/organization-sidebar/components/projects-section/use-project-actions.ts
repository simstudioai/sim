'use client'

import { useCallback } from 'react'
import { parseEnvironmentName } from '@/lib/projects'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import {
  useDeleteWorkspace,
  usePinnedWorkspaceIds,
  useToggleWorkspacePin,
  useUpdateWorkspace,
  useWorkspacesQuery,
} from '@/hooks/queries/workspace'

/**
 * Rename, pin and delete for a project, applied to every workspace of its lineage: a rename
 * keeps each environment's own suffix ("Staging", "Sandbox"), a delete removes forks before
 * their parent, and the pin lives on the root. Mock projects have no workspace, so every
 * action is a no-op for them.
 */
export function useProjectActions() {
  const { data: workspaces } = useWorkspacesQuery()
  const { data: pinnedIds } = usePinnedWorkspaceIds()
  const { mutate: togglePin } = useToggleWorkspacePin()
  const { mutateAsync: updateWorkspace, isPending: isRenaming } = useUpdateWorkspace()
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
      const base = name.trim()
      if (!base || base === project.name) return
      for (const environment of project.environments) {
        const workspace = workspaces?.find((candidate) => candidate.id === environment.workspaceId)
        if (!workspace) continue
        const { environment: suffix } = parseEnvironmentName(workspace.name)
        await updateWorkspace({
          workspaceId: workspace.id,
          name: suffix ? `${base} ${suffix}` : base,
        })
      }
    },
    [updateWorkspace, workspaces]
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
