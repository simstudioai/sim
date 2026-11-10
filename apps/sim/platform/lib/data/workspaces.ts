'use client'

import { toast } from '@/lib/toast/sink'
import { useLeaveWorkspace } from '@/hooks/queries/invitations'
import {
  useCreateWorkspace,
  useToggleWorkspacePin,
  useUpdateWorkspace,
} from '@/hooks/queries/workspace'
import type { ShellWorkspaceActions } from '@/platform/lib/data/models/shell'

/**
 * The legacy sidebar's workspace mutations. A new workspace lands in the shell's organization;
 * `hrefFor` names where a workspace opens. Leaving needs the viewer, so it waits for their id.
 */
export function useWorkspaceActions(
  organizationId: string,
  hrefFor: (workspaceId: string) => string,
  viewerId: string | undefined
): Omit<ShellWorkspaceActions, 'retry'> {
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const { mutateAsync: leaveWorkspace } = useLeaveWorkspace()
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
    ...(viewerId && {
      async leave(workspaceId: string) {
        await leaveWorkspace({ userId: viewerId, workspaceId })
      },
    }),
    setPinned: (workspaceId, pinned) =>
      togglePin({ workspaceId, pinned }, { onError: (error) => void toast.error(error.message) }),
  }
}
