import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { workflowFolderPathForId } from '@/lib/workflows/application/workflow-folders'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'

const logger = createLogger('ReadWorkflow')

export interface ReadWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export const readWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: ({ principal, input }: { principal: Principal; input: ReadWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, context }) {
    const snapshot = await loadWorkflowReadSnapshot(context.workflowId, context.workspaceId)
    const workflow = snapshot.workflowRecord
    if (!workflow || workflow.archivedAt || workflow.workspaceId !== context.workspaceId) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }
    const folderIndex = await loadActiveFolderPathIndex(
      context.workspaceId,
      'workflow',
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
    const inputs = extractInputFieldsFromBlocks(snapshot.normalizedData?.blocks ?? {})
    logger.info('Read workflow', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      principalKind: principal.kind,
    })
    return {
      workflow,
      workspaceId: context.workspaceId,
      inputs,
      folderPath: workflowFolderPathForId(folderIndex, workflow.folderId),
    }
  },
})
