import type { WorkflowGroup, WorkflowGroupDeploymentMode } from '@/lib/table/types'

/**
 * The workflow state a group runs against when it does not say. Groups run the
 * deployed version: a per-cell run is a headless execution, and the draft is
 * whatever a collaborator happens to have on the canvas at that moment.
 */
export const DEFAULT_WORKFLOW_GROUP_DEPLOYMENT_MODE: WorkflowGroupDeploymentMode = 'deployed'

/**
 * The mode a group effectively runs in. A stored group may predate the field
 * or omit it; every reader (dispatcher, presenter, UI) resolves it through
 * here so an absent value can never be read as a third, undefined mode.
 */
export function resolveWorkflowGroupDeploymentMode(
  group: Pick<WorkflowGroup, 'deploymentMode'>
): WorkflowGroupDeploymentMode {
  return group.deploymentMode ?? DEFAULT_WORKFLOW_GROUP_DEPLOYMENT_MODE
}
