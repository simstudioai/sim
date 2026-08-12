import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { logOperations } from '@/lib/logs/application/operations'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { getPublicWorkflowLog, getPublicWorkflowLogScope } from '@/lib/logs/public-queries'
import { sanitizeExecutionSnapshotState } from '@/lib/logs/snapshot-sanitizer'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

type PublicWorkflowLog = NonNullable<Awaited<ReturnType<typeof getPublicWorkflowLog>>>

interface PublicLogContext extends ActiveWorkspaceApplicationContext {
  executionId: string
  workflowId: string | null
}

export interface GetPublicLogInput {
  runId: string
}

export interface GetPublicLogResult {
  /** `workflowState` is the credential-redacted projection, never the stored snapshot. */
  log: Omit<PublicWorkflowLog, 'workflowState'> & {
    workflowState: Record<string, unknown> | null
  }
  workflowFolderPath: string | null
  executionData: Record<string, unknown>
}

export const getPublicLog = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.readDetail,
  resolveContext: async ({ input }: { input: GetPublicLogInput }): Promise<PublicLogContext> => {
    const scope = await getPublicWorkflowLogScope(input.runId)
    if (!scope) throw new OrchestrationError('not_found', 'Log not found')
    const workspace = await loadActiveWorkspaceApplicationContext(scope.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Log not found')
    return { ...workspace, executionId: scope.executionId, workflowId: scope.workflowId }
  },
  authorizationOptions: {},
  execute: async ({ principal, context }): Promise<GetPublicLogResult> => {
    const log = await getPublicWorkflowLog(
      { column: 'executionId', value: context.executionId },
      context.workspaceId
    )
    if (!log || log.workflowId !== context.workflowId) {
      throw new OrchestrationError('not_found', 'Log not found')
    }
    const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'workflow')
    const executionData = await materializeExecutionDataForDisplay(
      log.executionData as Record<string, unknown> | null,
      {
        workspaceId: context.workspaceId,
        workflowId: log.workflowId,
        executionId: log.executionId,
        userId: principal.kind === 'personal_api_key' ? principal.userId : undefined,
      }
    )
    if (log.workflowUserId && !log.workflowOwnerEmail) {
      throw new Error(`Unable to resolve workflow owner email for ${log.workflowUserId}`)
    }
    return {
      log: { ...log, workflowState: sanitizeExecutionSnapshotState(log.workflowState) },
      workflowFolderPath: log.workflowFolderId
        ? (folderIndex.pathById.get(log.workflowFolderId) ?? null)
        : null,
      executionData,
    }
  },
})
