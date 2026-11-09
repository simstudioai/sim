const activeDeployActions = new Set<string>()

export function tryAcquireDeployAction(workflowId: string): boolean {
  if (activeDeployActions.has(workflowId)) {
    return false
  }

  activeDeployActions.add(workflowId)
  return true
}

export function releaseDeployAction(workflowId: string): void {
  activeDeployActions.delete(workflowId)
}
