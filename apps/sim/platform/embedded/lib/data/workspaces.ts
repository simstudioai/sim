'use client'

import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import {
  useCreateWorkspace,
  useToggleWorkspacePin,
  useUpdateWorkspace,
} from '@/hooks/queries/workspace'
import { toast } from '@/platform/shared/toast'

export const workspaceHref = (workspaceId: string) => `${WORKSPACES_PATH}/${workspaceId}`

export function useWorkspaceActions() {
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace()
  const { mutate: togglePin } = useToggleWorkspacePin()
  return {
    /** Resolves with where the new workspace opens. */
    async create(name: string) {
      const workspace = await createWorkspace({ name })
      return workspaceHref(workspace.id)
    },
    async rename(workspaceId: string, name: string) {
      await updateWorkspace({ workspaceId, name })
    },
    setPinned: (workspaceId: string, pinned: boolean) =>
      togglePin({ workspaceId, pinned }, { onError: (error) => void toast.error(error.message) }),
  }
}
