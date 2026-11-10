export type WorkflowQueryScope = 'active' | 'archived' | 'all'

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  /** Every scope's list in one workspace, the bound a list's placeholder may cross. */
  workspaceLists: (workspaceId: string | undefined) =>
    [...workflowKeys.lists(), workspaceId ?? ''] as const,
  list: (workspaceId: string | undefined, scope: WorkflowQueryScope = 'active') =>
    [...workflowKeys.workspaceLists(workspaceId), scope] as const,
  deploymentVersions: () => [...workflowKeys.all, 'deploymentVersion'] as const,
  deploymentVersion: (
    workflowId: string | undefined,
    version: number | undefined,
    expectedDeploymentVersionId?: string
  ) =>
    [
      ...workflowKeys.deploymentVersions(),
      workflowId ?? '',
      version ?? 0,
      expectedDeploymentVersionId ?? '',
    ] as const,
  states: () => [...workflowKeys.all, 'state'] as const,
  state: (workflowId: string | undefined) => [...workflowKeys.states(), workflowId ?? ''] as const,
}
