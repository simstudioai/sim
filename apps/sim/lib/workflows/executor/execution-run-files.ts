import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { collectUserFilesById } from '@/lib/core/utils/user-file'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import type { UserFile } from '@/executor/types'

/** Run states whose recorded output is final and therefore safe to address. */
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export interface WorkflowRunFilesInput {
  workflowId: string
  runId: string
}

export interface WorkflowRunFiles {
  /** Whether the run has finished; a live run's output is still changing. */
  terminal: boolean
  workspaceId: string | null
  /** Files the run's recorded output references, indexed by their file id. */
  filesById: Map<string, UserFile>
}

/**
 * Reads the authoritative set of files a run produced.
 *
 * The set is derived from the run's own recorded execution data, materialized
 * but deliberately *not* projected for display: the display projection strips
 * `key` and `context` (see `USER_FILE_DISPLAY_FIELDS`), which are exactly the
 * fields a byte read needs. Because the mapping from file id to storage key is
 * rebuilt here from the recording on every call, a caller can name a file only
 * by an id the run itself emitted — it can never supply, influence, or probe a
 * storage key.
 *
 * Returns `null` when no log row exists for the run.
 */
export async function getWorkflowRunFiles(
  input: WorkflowRunFilesInput
): Promise<WorkflowRunFiles | null> {
  const [logRow] = await db
    .select({
      workspaceId: workflowExecutionLogs.workspaceId,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      status: workflowExecutionLogs.status,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, input.runId),
        eq(workflowExecutionLogs.workflowId, input.workflowId)
      )
    )
    .limit(1)

  if (!logRow) return null

  const terminal = TERMINAL_RUN_STATUSES.has(logRow.status)
  if (!terminal) {
    return { terminal: false, workspaceId: logRow.workspaceId, filesById: new Map() }
  }

  const materialized = await materializeExecutionData(
    logRow.executionData as Record<string, unknown> | null,
    {
      workspaceId: logRow.workspaceId,
      workflowId: logRow.workflowId,
      executionId: logRow.executionId,
    }
  )

  return {
    terminal: true,
    workspaceId: logRow.workspaceId,
    filesById: collectUserFilesById(materialized),
  }
}
