import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
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
  /**
   * The run's workflow folder as a canonical path — `/` at the workspace root,
   * matching what the workflow resources report for the same workflow — or
   * `null` when no path can be resolved for it.
   *
   * The two used to collapse into `null`, which made the field unreadable in
   * both directions: a caller could not tell a root-level workflow from one
   * whose folder had aged out, and `null` is not a value `folderPaths` would
   * take back as a filter.
   */
  workflowFolderPath: string | null
  executionData: Record<string, unknown>
}

/**
 * A run's folder path, distinguishing the root from an unresolvable folder.
 *
 * Deliberately not `workflowFolderPathForId`, which throws on a folder missing
 * from the index. That is right for a workflow read, where an unresolvable
 * folder means the caller's own tree is inconsistent; it is wrong for a
 * diagnostic log read, where the run may long outlive the folder it ran in and a
 * 500 would withhold the whole run over one unresolvable field.
 */
function publicLogFolderPath(
  pathById: ReadonlyMap<string, string>,
  folderId: string | null
): string | null {
  if (!folderId) return ROOT_FOLDER_PATH
  return pathById.get(folderId) ?? null
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
      workflowFolderPath: publicLogFolderPath(folderIndex.pathById, log.workflowFolderId),
      executionData,
    }
  },
})
