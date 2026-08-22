import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowRunApplicationContext,
  resolveActiveWorkflowRunApplicationContext,
} from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { getWorkflowRunFiles } from '@/lib/workflows/executor/execution-run-files'
import { classifyRunFileStorageError } from '@/lib/workflows/executor/run-file-storage-error'
import type { UserFile } from '@/executor/types'

/**
 * One message for every way a file fails to resolve — unknown run, unknown file
 * id, a file id belonging to a different run, or an object the retention sweep
 * has already collected. Distinguishing them would let a caller probe which run
 * ids and file ids exist.
 */
const FILE_NOT_FOUND_MESSAGE = 'File not found'

export interface DownloadWorkflowRunFileInput {
  workflowId: string
  runId: string
  fileId: string
}

export interface DownloadWorkflowRunFileResult {
  file: UserFile
  stream: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number
}

async function executeDownloadWorkflowRunFile({
  context,
  input,
}: AuthorizedWorkspaceUseCaseContext<
  typeof workflowOperations.downloadRunFile,
  DownloadWorkflowRunFileInput,
  ActiveWorkflowRunApplicationContext
>): Promise<DownloadWorkflowRunFileResult> {
  const runFiles = await getWorkflowRunFiles({
    workflowId: context.workflowId,
    runId: context.runId,
  })
  if (!runFiles) throw new OrchestrationError('not_found', FILE_NOT_FOUND_MESSAGE)

  /**
   * A run still in flight has no settled output, so there is nothing
   * authoritative to address yet. This is retryable rather than a fault.
   */
  if (!runFiles.terminal) {
    throw new OrchestrationError(
      'conflict',
      'Run has not finished yet; its output files are available once it reaches a terminal state.'
    )
  }

  /**
   * The caller's `fileId` selects a record; it never supplies one. `key` and
   * `context` come off the run's own recording, so the bytes served are always
   * bytes this run produced.
   */
  const file = runFiles.filesById.get(input.fileId)
  if (!file) throw new OrchestrationError('not_found', FILE_NOT_FOUND_MESSAGE)

  /**
   * The storage context is inferred from the key rather than read off the
   * record's `context` field, so the bucket a read targets is always the one
   * the key itself names. This mirrors `getVerifiedStorageContext`, which
   * treats a recorded context that disagrees with its key as untrustworthy.
   */
  let stream: Awaited<ReturnType<typeof downloadFileStream>>
  try {
    stream = await downloadFileStream({
      key: file.key,
      context: inferContextFromKey(file.key),
    })
  } catch (error) {
    /**
     * An object retention has already collected is one of the four ways this
     * read fails to resolve, and the shared message covers it deliberately —
     * naming the storage cause here would separate "no such file" from "the
     * bytes are gone", which is exactly the probe the single message prevents.
     */
    throw classifyRunFileStorageError(error, FILE_NOT_FOUND_MESSAGE)
  }

  return {
    file,
    stream: nodeReadableToWebStream(stream),
    contentType: file.type || 'application/octet-stream',
    contentLength: file.size,
  }
}

/**
 * Authorized, audited binary download of one file a run produced.
 *
 * Authorization is the run's: `resolveActiveWorkflowRunApplicationContext`
 * binds the run to its canonical workflow and workspace before the operation's
 * role and workspace-key policy are applied, so a workspace-scoped key can only
 * ever reach runs inside its own workspace. The file is then resolved against
 * that run's recording rather than against any caller-supplied storage address.
 */
export const downloadWorkflowRunFileStream = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.downloadRunFile,
  resolveContext: ({ input }: { input: DownloadWorkflowRunFileInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
    }),
  execute: executeDownloadWorkflowRunFile,
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Downloaded run file "${result.file.name}"`,
    metadata: {
      fileId: result.file.id,
      fileName: result.file.name,
      bytes: result.contentLength,
      workflowId: context.workflowId,
      runId: context.runId,
    },
  }),
})
