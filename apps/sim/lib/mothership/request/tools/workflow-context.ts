import { isRecordLike } from '@sim/utils/object'
import type { ExecutionContext } from '@/lib/mothership/request/types'

function getCreateWorkflowOutput(
  output: unknown
): { workflowId?: string; workspaceId?: string } | undefined {
  if (!isRecordLike(output)) return undefined

  const workflowId = typeof output.workflowId === 'string' ? output.workflowId : undefined
  const workspaceId = typeof output.workspaceId === 'string' ? output.workspaceId : undefined
  if (!workflowId && !workspaceId) return undefined
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  }
}

/** Adopts a same-workspace workflow created by the current unrooted Copilot lifecycle. */
export function applyCreateWorkflowOutputToContext(
  output: unknown,
  context: ExecutionContext
): void {
  const createdWorkflow = getCreateWorkflowOutput(output)
  if (
    !createdWorkflow?.workflowId ||
    !createdWorkflow.workspaceId ||
    createdWorkflow.workspaceId !== context.workspaceId ||
    context.workflowId
  ) {
    return
  }
  context.workflowId = createdWorkflow.workflowId
}
