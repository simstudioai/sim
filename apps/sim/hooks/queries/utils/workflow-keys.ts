export type WorkflowQueryScope = 'active' | 'archived' | 'all'

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, scope: WorkflowQueryScope = 'active') =>
    [...workflowKeys.lists(), workspaceId ?? '', scope] as const,
  deploymentVersions: () => [...workflowKeys.all, 'deploymentVersion'] as const,
  deploymentVersion: (workflowId: string | undefined, version: number | undefined) =>
    [...workflowKeys.deploymentVersions(), workflowId ?? '', version ?? 0] as const,
  states: () => [...workflowKeys.all, 'state'] as const,
  state: (workflowId: string | undefined) => [...workflowKeys.states(), workflowId ?? ''] as const,
}
