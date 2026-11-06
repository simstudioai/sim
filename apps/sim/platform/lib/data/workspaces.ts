'use client'

import {
  useCreateWorkspace,
  useToggleWorkspacePin,
  useUpdateWorkspace,
} from '@/hooks/queries/workspace'
import type { ShellWorkspaceActions } from '@/platform/app/(shell)/_components/model'
import { toast } from '@/platform/shared/toast'

/** The legacy sidebar's workspace mutations. `hrefFor` names where a workspace opens. */
export function useWorkspaceActions(
  hrefFor: (workspaceId: string) => string
): Omit<ShellWorkspaceActions, 'retry'> {
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace()
  const { mutate: togglePin } = useToggleWorkspacePin()
  return {
    async create(name) {
      const workspace = await createWorkspace({ name })
      return hrefFor(workspace.id)
    },
    async rename(workspaceId, name) {
      await updateWorkspace({ workspaceId, name })
    },
    setPinned: (workspaceId, pinned) =>
      togglePin({ workspaceId, pinned }, { onError: (error) => void toast.error(error.message) }),
  }
}
