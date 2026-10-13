/**
 * Removes one mounted editor's room request. Each mounted editor pushes its
 * workflow on mount and releases it on unmount, so the room follows the most
 * recently mounted editor and falls back to the one beneath it when it leaves.
 */
export function releaseWorkflowRequest(requests: string[], workflowId: string): string[] {
  const index = requests.lastIndexOf(workflowId)
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
