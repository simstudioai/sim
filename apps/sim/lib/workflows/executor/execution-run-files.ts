import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { collectUserFilesById } from '@/lib/core/utils/user-file'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { formatFileSize, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { isRunOutputFileKey } from '@/lib/workflows/executor/run-file-scope'
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
 * fields a byte read needs.
 *
 * Rebuilding the id→key mapping from the recording is necessary but not
 * sufficient: the recording itself contains caller-supplied input echoed
 * verbatim by the start block, so it can carry a `UserFile` naming any storage
 * key. Every entry is therefore filtered through {@link isRunOutputFileKey},
 * which admits only keys under this run's own execution prefix. Downstream byte
 * reads rely on that filter — they perform no per-file authorization of their
 * own, because after it there is no key left that is not this run's output.
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

  const scope = {
    workspaceId: logRow.workspaceId,
    workflowId: logRow.workflowId,
    executionId: logRow.executionId,
  }
  const filesById = new Map<string, UserFile>()
  for (const [id, file] of collectUserFilesById(materialized)) {
    if (isRunOutputFileKey(file.key, scope)) {
      filesById.set(id, file)
    }
  }

  return { terminal: true, workspaceId: logRow.workspaceId, filesById }
}

/** Public path a caller uses to fetch one run file's bytes. */
export function workflowRunFileDownloadPath(
  workflowId: string,
  runId: string,
  fileId: string
): string {
  return `/api/v2/workflows/${workflowId}/runs/${runId}/files/${fileId}`
}

export interface WorkflowRunFileDescriptor {
  id: string
  name: string
  size: number
  type: string
  downloadPath: string
  base64: string | null
}

export interface DescribeWorkflowRunFilesOptions {
  workflowId: string
  runId: string
  includeBase64: boolean
  /** Inline ceiling per file. Clamped to the executor's own inline limit. */
  base64MaxBytes?: number
}

/**
 * Projects a run's recorded files into public descriptors.
 *
 * The storage `key` is deliberately absent from the descriptor: a caller
 * addresses a file by `id` at {@link workflowRunFileDownloadPath}, and the key
 * is re-derived server side from the recording on every request.
 *
 * Inline hydration reads the bytes with the key taken from that same recording,
 * under the run authorization the caller already passed. It does not re-derive
 * an acting user to re-check per-file ownership, because there is no
 * user-scoped question left to ask: the bytes are this run's own output and the
 * run has already been bound to the caller's workspace.
 */
export async function describeWorkflowRunFiles(
  filesById: Map<string, UserFile>,
  options: DescribeWorkflowRunFilesOptions
): Promise<WorkflowRunFileDescriptor[]> {
  const cap = Math.min(
    options.base64MaxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
    MAX_INLINE_MATERIALIZATION_BYTES
  )

  return Promise.all(
    Array.from(filesById.values(), async (file) => {
      const downloadPath = workflowRunFileDownloadPath(options.workflowId, options.runId, file.id)
      if (!options.includeBase64) {
        return {
          id: file.id,
          name: file.name,
          size: file.size,
          type: file.type,
          downloadPath,
          base64: null,
        }
      }
      if (file.size > cap) {
        throw new OrchestrationError(
          'payload_too_large',
          `File "${file.name}" (${formatFileSize(file.size)}) exceeds the ${formatFileSize(cap)} inline limit; download it with GET ${downloadPath}`
        )
      }
      const content = await downloadFile({
        key: file.key,
        context: inferContextFromKey(file.key),
        maxBytes: cap,
      })
      return {
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        downloadPath,
        base64: content.toString('base64'),
      }
    })
  )
}
