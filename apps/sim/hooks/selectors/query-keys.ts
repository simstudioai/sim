export const selectorKeys = {
  all: ['selectors'] as const,
  simWorkflowsPrefix: (workspaceId: string) =>
    [...selectorKeys.all, 'sim.workflows', workspaceId] as const,
  simWorkflows: (workspaceId: string, excludeWorkflowId?: string) =>
    [...selectorKeys.simWorkflowsPrefix(workspaceId), excludeWorkflowId ?? 'none'] as const,
}
