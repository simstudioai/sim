/** Tool results and realtime notifications enter the same canvas reconciliation path. */
export const WORKFLOW_EXTERNAL_UPDATE_EVENT = 'workflow-external-update'

export function notifyWorkflowExternalUpdate(workflowId: string): void {
  window.dispatchEvent(new CustomEvent(WORKFLOW_EXTERNAL_UPDATE_EVENT, { detail: { workflowId } }))
}
