import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { MAX_RENDERED_DOCUMENT_BYTES, needsRenderedArtifact } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface DownloadWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Trusted runtime callers can request the classification bound to the streamed bytes. */
  includeSecretProvenance?: boolean
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
  secretProvenance?: WorkspaceFileSecretProvenance
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

function resolveRenderedArtifact(
  file: DownloadWorkspaceFileResult['file'],
  filePrincipal: AuthorizedWorkspaceUseCaseContext<
    typeof fileOperations.download,
    DownloadWorkspaceFileInput,
    ActiveWorkspaceFileContext
  >['principal']
) {
  return resolveRenderedWorkspaceArtifact(file, filePrincipal, {
    maxBytes: MAX_RENDERED_DOCUMENT_BYTES,
  })
}

async function executeDownloadWorkspaceFileStream({
  input,
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
  const secretProvenance = input.includeSecretProvenance
    ? await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
        fileId: file.id,
        key: file.key,
        context: file.storageContext ?? 'workspace',
        contentUpdatedAt: file.contentUpdatedAt ?? undefined,
      })
    : undefined

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
      ...(secretProvenance ? { secretProvenance } : {}),
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
    ...(secretProvenance ? { secretProvenance } : {}),
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
