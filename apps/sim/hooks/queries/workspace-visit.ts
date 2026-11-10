import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  recordWorkspaceVisitContract,
  type WorkspacesResponse,
} from '@/lib/api/contracts/workspaces'
import { workspaceKeys } from '@/hooks/queries/utils/workspace-keys'
import { useWorkspaceListOrganizationId } from '@/hooks/queries/utils/workspace-list-organization'

/** Identifies visits in the mutation cache so `onSettled` can tell whether it is the last one. */
const WORKSPACE_VISIT_MUTATION_KEY = ['workspace', 'record-visit'] as const

/**
 * Records that the viewer opened a workspace, moving it to the front of the cached
 * list at once. `scope` sends visits one at a time so the server stamps them in the
 * order they happened.
 */
export function useRecordWorkspaceVisit() {
  const queryClient = useQueryClient()
  const queryKey = workspaceKeys.list('active', useWorkspaceListOrganizationId())

  return useMutation({
    mutationKey: WORKSPACE_VISIT_MUTATION_KEY,
    scope: { id: 'workspace-visit' },
    mutationFn: (workspaceId: string) =>
      requestJson(recordWorkspaceVisitContract, { params: { id: workspaceId } }),
    onMutate: async (workspaceId) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<WorkspacesResponse>(queryKey, (old) => {
        const visited = old?.workspaces.find((ws) => ws.id === workspaceId)
        if (!old || !visited) return old
        return {
          ...old,
          lastActiveWorkspaceId: workspaceId,
          workspaces: [visited, ...old.workspaces.filter((ws) => ws !== visited)],
        }
      })
    },
    /**
     * Reconciles once no later visit is queued behind the scope — refetching earlier
     * would render the server's intermediate order over the later optimistic one.
     */
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: WORKSPACE_VISIT_MUTATION_KEY }) > 1) return
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}
