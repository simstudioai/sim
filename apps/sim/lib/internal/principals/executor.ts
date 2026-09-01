import {
  type BoundWorkflowExecutionPrincipal,
  requirePrincipalExecutionMetadata,
  resolvePrincipalSubject,
} from '@sim/auth/principal'
import { bindRuntimeWorkflowExecutionPrincipal } from '@/lib/auth/internal-delegation'
import { WorkflowExecutionPrincipalRequiredError } from '@/lib/internal/tool-operations/identity-faults'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

export interface CreateExecutorPrincipalFromExecutionContextInput {
  context: InternalToolOperationContext
}

/** Returns the executor's asserted workspace scope or fails at the tool boundary. */
export function requireExecutorWorkspaceId(
  context: Pick<InternalToolOperationContext, 'workspaceId'>
): string {
  if (!context.workspaceId?.trim()) throw new Error('Workflow execution workspace is required')
  return context.workspaceId
}

/** Revalidates the runtime principal before an in-process application operation. */
export async function createExecutorPrincipalFromExecutionContext({
  context,
}: CreateExecutorPrincipalFromExecutionContextInput): Promise<BoundWorkflowExecutionPrincipal> {
  if (!context.principal) throw new WorkflowExecutionPrincipalRequiredError()
  requirePrincipalExecutionMetadata(context.principal)
  const subject = resolvePrincipalSubject(context.principal)
  return bindRuntimeWorkflowExecutionPrincipal(
    context.principal as BoundWorkflowExecutionPrincipal,
    !subject && context.userId ? { compatibilityActorUserId: context.userId } : undefined
  )
}
