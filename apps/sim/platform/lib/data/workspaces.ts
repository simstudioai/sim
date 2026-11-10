'use client'

import { toast } from '@/lib/toast/sink'
import {
  useCreateWorkspace,
  useToggleWorkspacePin,
  useUpdateWorkspace,
} from '@/hooks/queries/workspace'
import type { ShellWorkspaceActions } from '@/platform/lib/data/models/shell'

/**
 * The legacy sidebar's workspace mutations. A new workspace lands in the shell's organization;
 * `hrefFor` names where a workspace opens.
 */
export function useWorkspaceActions(
  organizationId: string,
  hrefFor: (workspaceId: string) => string
): Omit<ShellWorkspaceActions, 'retry'> {
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace()
  const { mutate: togglePin } = useToggleWorkspacePin()
  return {
    async create(name) {
      const workspace = await createWorkspace({ name, organizationId })
      return hrefFor(workspace.id)
    },
    async rename(workspaceId, name) {
      await updateWorkspace({ workspaceId, name })
    },
    setPinned: (workspaceId, pinned) =>
      togglePin({ workspaceId, pinned }, { onError: (error) => void toast.error(error.message) }),
  }
}
