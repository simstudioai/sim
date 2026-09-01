import type { CostLedger } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { logDelegationAuthorization } from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { buildCostLedger } from '@/lib/logs/cost-ledger'
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
   * The two must stay distinct: collapsing both into `null` leaves a caller
   * unable to tell a root-level workflow from one whose folder aged out, and
   * `null` is not a value `folderPaths` takes back as a filter.
   */
  workflowFolderPath: string | null
  executionData: Record<string, unknown>
  /**
   * The run's itemized billing lines, or `null` when no ledger exists for it.
   *
   * `null` is a distinct answer from an empty item list and is reachable: the
   * ledger is keyed on `usage_log` rows recorded with `source = 'workflow'`, so a
   * run that predates the ledger has none at all.
   */
  costLedger: CostLedger | null
}

/**
 * A run's folder path, distinguishing the root from an unresolvable folder.
 *
 * Deliberately not `workflowFolderPathForId`, which throws on a folder missing
 * from the index. That is right for a workflow read, where an unresolvable
 * folder means the caller's own tree is inconsistent; it is wrong for a
 * diagnostic log read, where the run may long outlive the folder it ran in and a
 * 500 would withhold the whole run over one unresolvable field.
 *
 * `workflowExists` is the join, not the folder: the log's `workflow_id` is set
 * null when the workflow is deleted, so the left join yields a null `folderId`
 * that is indistinguishable from a workflow sitting at the workspace root. Left
 * unseparated, a run whose workflow is gone reports the root path next to
 * `deleted: true` — a path the caller can hand back to `folderPaths` as a filter
 * for a workflow that is no longer in any folder at all.
 */
function publicLogFolderPath(
  pathById: ReadonlyMap<string, string>,
  folderId: string | null,
  workflowExists: boolean
): string | null {
  if (!workflowExists) return null
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
  authorizationOptions: logDelegationAuthorization<PublicLogContext>(),
  execute: async ({ principal, context }): Promise<GetPublicLogResult> => {
    const log = await getPublicWorkflowLog(
      { column: 'executionId', value: context.executionId },
      context.workspaceId
    )
    if (!log || log.workflowId !== context.workflowId) {
      throw new OrchestrationError('not_found', 'Log not found')
    }
    const folderIndex = await loadActiveFolderPathIndex(
      context.workspaceId,
      'workflow',
      undefined,
      {
        maxRows: MAX_FOLDERS_PER_WORKSPACE,
      }
    )
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
    const costLedger = await buildCostLedger(log.executionId)
    return {
      log: { ...log, workflowState: sanitizeExecutionSnapshotState(log.workflowState) },
      costLedger,
      workflowFolderPath: publicLogFolderPath(
        folderIndex.pathById,
        log.workflowFolderId,
        log.workflowName !== null
      ),
      executionData,
    }
  },
})
