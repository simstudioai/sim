import { resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { assertUserFileContentAccess } from '@/lib/execution/payloads/materialization.server'
import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'
import { DocumentOperationError } from '@/lib/internal/oci-document-understanding/errors'
import {
  type AnalysisInput,
  DOCUMENT_INLINE_BYTES,
} from '@/lib/internal/oci-document-understanding/schema'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import {
  isModelSafeWorkspaceFileKey,
  isOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const logger = createLogger('OciDocumentInput')

export async function validateDocumentBytes(buffer: Buffer, signal?: AbortSignal) {
  if (buffer.length === 0 || buffer.length > DOCUMENT_INLINE_BYTES) {
    throw new DocumentOperationError('Inline documents must contain at most 8,000,000 bytes', 413)
  }
  signal?.throwIfAborted()
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    const pdf = await openPdfDocument(new Uint8Array(buffer), signal)
    try {
      if (pdf.numPages > 5)
        throw new DocumentOperationError('Inline documents must have at most five pages')
    } finally {
      await pdf.destroy()
    }
    return
  }
  const { default: sharp } = await import('sharp')
  const metadata = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata()
  signal?.throwIfAborted()
  if (!['jpeg', 'png', 'tiff'].includes(metadata.format ?? '')) {
    throw new DocumentOperationError('Only JPEG, PNG, PDF and TIFF documents are supported')
  }
  if ((metadata.pages ?? 1) > 5)
    throw new DocumentOperationError('Inline documents must have at most five pages')
  const height = metadata.pageHeight ?? metadata.height ?? 0
  const width = metadata.width ?? 0
  if (width < 32 || height < 32 || width > 10000 || height > 10000) {
    throw new DocumentOperationError(
      'Document images must be between 32 and 10,000 pixels in each dimension'
    )
  }
}

export async function prepareDocumentSource(
  input: AnalysisInput,
  request: InternalToolOperationCall
) {
  const provenance = validateOpaqueModelInputProvenance({
    headers: request.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) throw new DocumentOperationError(provenance.error, provenance.status)
  if (input.source === 'objectStorage') {
    return input.operation === 'analyze_document'
      ? { source: 'OBJECT_STORAGE', ...input.objects![0] }
      : { sourceType: 'OBJECT_STORAGE_LOCATIONS', objectLocations: input.objects! }
  }
  const file = input.file!
  const workspaceId = request.context.workspaceId!
  const principal = await createExecutorPrincipalFromExecutionContext({
    context: request.context,
    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  })
  const subject = resolvePrincipalSubject(principal)
  const userId = subject?.kind === 'sim_user' ? subject.userId : undefined
  try {
    await assertUserFileContentAccess(file, {
      ...request.context,
      principal,
      userId,
      requestId: request.requestId,
      logger,
    })
  } catch {
    throw new DocumentOperationError('File is not available in this execution', 404)
  }
  request.signal?.throwIfAborted()
  if (!(await isModelSafeWorkspaceFileKey(file.key, { workspaceId, actorUserId: userId }))) {
    throw new DocumentOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
  }
  const servable = await downloadServableFileFromStorage(file, request.requestId, logger, {
    maxBytes: DOCUMENT_INLINE_BYTES,
    signal: request.signal,
    filePrincipal: principal,
  })
  for (const contributor of servable.contributingFiles ?? []) {
    request.signal?.throwIfAborted()
    if (!(await isOpaqueWorkspaceFileEgressSafe(workspaceId, contributor))) {
      throw new DocumentOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    }
  }
  await validateDocumentBytes(servable.buffer, request.signal)
  request.signal?.throwIfAborted()
  return {
    ...(input.operation === 'analyze_document'
      ? { source: 'INLINE' }
      : { sourceType: 'INLINE_DOCUMENT_CONTENT' }),
    data: servable.buffer.toString('base64'),
    ...(input.pageRange ? { pageRange: input.pageRange } : {}),
  }
}
