import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import {
  formatFileSize,
  MAX_RENDERED_DOCUMENT_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface DownloadWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DownloadWorkspaceFileResult {
  file: NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
}

export interface DownloadWorkspaceFileStreamResult extends DownloadWorkspaceFileResult {
  stream: ReadableStream<Uint8Array>
  /**
   * What to advertise for the bytes actually served. Both differ from the record
   * for a generated doc, whose compiled artifact is neither the stored source's
   * size nor its MIME.
   */
  contentLength: number
  contentType: string
}

/** Audits the bytes actually handed out, which for a generated doc is not `file.size`. */
function projectDownloadAudit(file: DownloadWorkspaceFileResult['file'], servedBytes?: number) {
  return {
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Downloaded file "${file.name}"`,
    metadata: {
      fileId: file.id,
      fileName: file.name,
      bytes: servedBytes ?? file.size,
    },
  }
}

async function executeDownloadWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.download,
  DownloadWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DownloadWorkspaceFileResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file }
}

export const downloadWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDownloadWorkspaceFile,
  projectAudit: ({ result }) => projectDownloadAudit(result.file),
})

/**
 * Resolves a generation-source record to its compiled artifact.
 *
 * The record's declared size bounds nothing here — a source is text and orders
 * of magnitude smaller than what it renders to — so the artifact is checked
 * against its own ceiling. Note this rejects an oversized artifact rather than
 * preventing it being read: the artifact store fetch is not itself streaming-
 * bounded, so the bytes are resident before the check rejects them.
 *
 * An artifact that is still compiling is retryable rather than a fault, so it
 * surfaces as `conflict` — a 500 would give the caller no reason to try again.
 * A generation script that failed permanently raises the same error class but
 * will never succeed on a retry, so it keeps its own message instead of the
 * "still being generated" copy, which would tell the caller to wait for an
 * artifact that never appears. It stays a `conflict` only because the v2
 * envelope has no 422; the message is what distinguishes the two.
 */
async function resolveRenderedArtifact(
  file: DownloadWorkspaceFileResult['file'],
  filePrincipal: AuthorizedWorkspaceUseCaseContext<
    typeof fileOperations.download,
    DownloadWorkspaceFileInput,
    ActiveWorkspaceFileContext
  >['principal']
) {
  try {
    return await fetchAuthorizedServableWorkspaceFileBuffer(file, filePrincipal, {
      maxBytes: MAX_RENDERED_DOCUMENT_BYTES,
    })
  } catch (error) {
    if (isDocNotReadyError(error)) {
      if (error.pending) throw new OrchestrationError('conflict', docNotReadyMessage())
      throw new OrchestrationError(
        'conflict',
        `"${file.name}" could not be generated: ${error.message}`
      )
    }
    if (isPayloadSizeLimitError(error)) {
      throw new OrchestrationError(
        'payload_too_large',
        `"${file.name}" renders to more than ${formatFileSize(MAX_RENDERED_DOCUMENT_BYTES)} and is too large to download.`
      )
    }
    throw error
  }
}

async function executeDownloadWorkspaceFileStream({
  context,
  principal,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.download,
  DownloadWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DownloadWorkspaceFileStreamResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')

  /**
   * AI-generated docs store their generation SOURCE as the primary file and keep
   * the rendered binary in a separate artifact store, so streaming `file.key`
   * raw would hand back source text under a `.pdf` name. Resolving that costs a
   * buffer, so it is gated on the recorded generation-source type — a genuinely
   * uploaded `.pdf` keeps streaming and never materializes. The artifact is
   * enqueued as a view over that buffer, not a copy, which would otherwise
   * double peak memory.
   */
  if (needsRenderedArtifact(file.type, file.name)) {
    const { buffer, contentType } = await resolveRenderedArtifact(file, principal)
    return {
      file,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)
          )
          controller.close()
        },
      }),
      contentLength: buffer.length,
      contentType,
    }
  }

  const stream = await downloadFileStream({
    key: file.key,
    context: file.storageContext ?? 'workspace',
  })
  return {
    file,
    stream: nodeReadableToWebStream(stream),
    contentLength: file.size,
    contentType: file.type || 'application/octet-stream',
  }
}

/**
 * Authorized and audited binary download. Ordinary files stream without being
 * materialized; generated docs resolve to their compiled artifact first.
 */
export const downloadWorkspaceFileStream = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDownloadWorkspaceFileStream,
  projectAudit: ({ result }) => projectDownloadAudit(result.file, result.contentLength),
})
