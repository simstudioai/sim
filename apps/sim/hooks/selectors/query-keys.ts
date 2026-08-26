import { environmentDependentSelectorKeys } from '@/hooks/selectors/cache-invalidation'

export const selectorKeys = {
  all: environmentDependentSelectorKeys.primary,
  simWorkflowsPrefix: (workspaceId: string) =>
    [...selectorKeys.all, 'sim.workflows', workspaceId] as const,
  simWorkflows: (workspaceId: string, excludeWorkflowId?: string) =>
    [...selectorKeys.simWorkflowsPrefix(workspaceId), excludeWorkflowId ?? 'none'] as const,
}
