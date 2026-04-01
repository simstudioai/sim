import type { QueryClient } from '@tanstack/react-query'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { selectorKeys } from '@/hooks/selectors/query-keys'

export async function invalidateWorkflowSelectors(queryClient: QueryClient, workspaceId: string) {
  await queryClient.invalidateQueries({ queryKey: selectorKeys.simWorkflowsPrefix(workspaceId) })
}

/**
 * Invalidates workflow list consumers for a single workspace.
 */
export async function invalidateWorkflowLists(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: WorkflowQueryScope[] = ['active']
) {
  const uniqueScopes = [...new Set(scopes)]

  await Promise.all([
    ...uniqueScopes.map((scope) =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId, scope) })
    ),
    invalidateWorkflowSelectors(queryClient, workspaceId),
  ])
}
