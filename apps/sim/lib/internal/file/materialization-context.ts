import type { ExecutionMaterializationContext } from '@/lib/execution/payloads/materialization.server'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import { tryInferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import type { ExecutionContext, UserFile } from '@/executor/types'

/** Binds actorless workspace reads to the same trusted execution authority as File tools. */
export async function resolveExecutorFileMaterializationContext(
  context: ExecutionContext,
  file: Pick<UserFile, 'key'>
): Promise<ExecutionMaterializationContext> {
  const requiresDelegation =
    context.principal?.kind === 'system' && tryInferContextFromKey(file.key) === 'workspace'
  const principal = requiresDelegation
    ? await createExecutorPrincipalFromExecutionContext({
        context,
        audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      })
    : context.principal

  return {
    principal,
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
    userId: requiresDelegation ? undefined : context.userId,
    requestId: context.executionId || context.workflowId || 'agent-files',
  }
}
