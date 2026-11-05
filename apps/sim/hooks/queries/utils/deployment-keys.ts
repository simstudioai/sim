import type { QueryClient } from '@tanstack/react-query'

/**
 * Query key factory for deployment-related queries
 */
export const deploymentKeys = {
  all: ['deployments'] as const,
  infos: () => [...deploymentKeys.all, 'info'] as const,
  info: (workflowId: string | null) => [...deploymentKeys.infos(), workflowId ?? ''] as const,
  deployedState: (workflowId: string | null) =>
    [...deploymentKeys.all, 'deployedState', workflowId ?? ''] as const,
  allVersions: () => [...deploymentKeys.all, 'versions'] as const,
  versions: (workflowId: string | null) =>
    [...deploymentKeys.allVersions(), workflowId ?? ''] as const,
  chatStatuses: () => [...deploymentKeys.all, 'chatStatus'] as const,
  chatStatus: (workflowId: string | null) =>
    [...deploymentKeys.chatStatuses(), workflowId ?? ''] as const,
  chatDetails: () => [...deploymentKeys.all, 'chatDetail'] as const,
  chatDetail: (chatId: string | null) => [...deploymentKeys.chatDetails(), chatId ?? ''] as const,
}

/**
 * Invalidates the core deployment queries (info, deployedState, versions) for a workflow.
 * Used by mutation onSuccess callbacks and manual invalidation after chat deployments.
 */
export function invalidateDeploymentQueries(queryClient: QueryClient, workflowId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: deploymentKeys.info(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.deployedState(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(workflowId) }),
    queryClient.invalidateQueries({ queryKey: deploymentKeys.chatStatus(workflowId) }),
  ])
}
