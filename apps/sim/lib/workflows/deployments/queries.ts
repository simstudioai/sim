import { type ActiveWorkflowRecord, getActiveWorkflowRecord } from '@sim/platform-authz/workflow'

export interface DeploymentWorkflowTarget {
  workflow: ActiveWorkflowRecord
  workspaceId: string
}

/** Loads the active workflow facts shared by every deployment adapter. */
export async function getDeploymentWorkflowTarget(
  workflowId: string
): Promise<DeploymentWorkflowTarget | null> {
  const workflow = await getActiveWorkflowRecord(workflowId)
  if (!workflow?.workspaceId) return null
  return { workflow, workspaceId: workflow.workspaceId }
}
