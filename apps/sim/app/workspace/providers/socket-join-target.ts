/** One mounted editor's request for a workflow room; the token identifies that mount. */
export interface WorkflowRequest {
  token: string
  workflowId: string
}

/**
 * Removes one mounted editor's room request. Each mount pushes a request and releases it by
 * token on unmount, so the room follows the most recently mounted editor and falls back to
 * the one beneath it when it leaves.
 */
export function releaseWorkflowRequest(
  requests: WorkflowRequest[],
  token: string
): WorkflowRequest[] {
  const index = requests.findIndex((request) => request.token === token)
  if (index === -1) return requests
  return [...requests.slice(0, index), ...requests.slice(index + 1)]
}

interface IsSocketWorkflowVisibleArgs {
  workflowId?: string | null
  requestedWorkflowId: string | null
}

export function isSocketWorkflowVisible({
  workflowId,
  requestedWorkflowId,
}: IsSocketWorkflowVisibleArgs): boolean {
  return Boolean(workflowId) && workflowId === requestedWorkflowId
}
