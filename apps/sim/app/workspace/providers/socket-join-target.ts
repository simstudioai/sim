interface ResolveSocketWorkflowTargetArgs {
  routeWorkflowId?: string | null
  explicitWorkflowId?: string | null
}

export function resolveSocketWorkflowTarget({
  routeWorkflowId,
  explicitWorkflowId,
}: ResolveSocketWorkflowTargetArgs): string | null {
  return explicitWorkflowId ?? routeWorkflowId ?? null
}

interface IsSocketWorkflowVisibleArgs extends ResolveSocketWorkflowTargetArgs {
  workflowId?: string | null
}

export function isSocketWorkflowVisible({
  workflowId,
  routeWorkflowId,
  explicitWorkflowId,
}: IsSocketWorkflowVisibleArgs): boolean {
  const targetWorkflowId = workflowId ?? null
  if (!targetWorkflowId) {
    return false
  }

  return targetWorkflowId === resolveSocketWorkflowTarget({ routeWorkflowId, explicitWorkflowId })
}
