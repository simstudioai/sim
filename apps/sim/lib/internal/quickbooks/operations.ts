import { createLogger } from '@sim/logger'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import type {
  QuickBooksAddAttachmentBody,
  QuickBooksDownloadDocumentBody,
} from '@/lib/api/contracts/tools/quickbooks'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import {
  assertContentLengthWithinLimit,
  assertKnownSizeWithinLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  assertQuickBooksAttachmentExtension,
  assertSingleQuickBooksFile,
  buildQuickBooksAttachableMetadata,
  getQuickBooksDocumentError,
  getQuickBooksDocumentTransaction,
  parseQuickBooksAttachableResponse,
  QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS,
  QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS,
  QUICKBOOKS_MAX_ATTACHMENT_BYTES,
  QUICKBOOKS_TEMP_URL_MAX_BYTES,
  quickBooksDocumentSignal,
  sanitizeQuickBooksFileName,
  validateQuickBooksAttachmentFileType,
} from '@/tools/quickbooks/documents_utils'

const logger = createLogger('QuickBooksInternalOperations')

export interface QuickBooksOperationContext {
  userId: string
  requestId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  signal: AbortSignal
}

export class QuickBooksInternalOperationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'QuickBooksInternalOperationError'
  }
}

interface DownloadedDocument {
  buffer: Buffer
  mimeType: string
  fileName: string
}

async function errorFromResponse(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as { error?: unknown }
    if (typeof data.error === 'string' && data.error.trim()) message = data.error
  } catch {}
  throw new QuickBooksInternalOperationError(response.status, message)
}

function contentDispositionFileName(value: string | null): string | undefined {
  if (!value) return undefined
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (utf8) {
    try {
      return decodeURIComponent(utf8)
    } catch {
      return utf8
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]
}

async function downloadQuickBooksAttachment(
  body: Extract<QuickBooksDownloadDocumentBody, { documentKind: 'attachment' }>,
  signal: AbortSignal
): Promise<DownloadedDocument> {
  const downloadUrl = buildQuickBooksCompanyUrl(
    body.realmId,
    `download/${encodeURIComponent(body.attachmentId)}`,
    body.quickBooksEnvironment
  )
  const metadataSignal = quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS)
  const downloadUrlResponse = await fetch(downloadUrl, {
    method: 'GET',
    headers: { ...buildQuickBooksHeaders(body.accessToken), Accept: '*/*' },
    signal: metadataSignal,
  })
  if (downloadUrlResponse.status === 404) {
    throw new Error('This QuickBooks attachment has no downloadable file')
  }
  if (!downloadUrlResponse.ok) {
    throw await getQuickBooksDocumentError(downloadUrlResponse, metadataSignal)
  }
  const temporaryUrlText = await readResponseTextWithLimit(downloadUrlResponse, {
    maxBytes: QUICKBOOKS_TEMP_URL_MAX_BYTES,
    label: 'QuickBooks attachment temporary URL response',
    signal: metadataSignal,
  })
  let temporaryUrl = temporaryUrlText.trim()
  if (temporaryUrl.startsWith('"')) {
    try {
      const parsed = JSON.parse(temporaryUrl)
      temporaryUrl = typeof parsed === 'string' ? parsed.trim() : ''
    } catch {
      throw new Error('QuickBooks returned a malformed attachment download URL')
    }
  }
  if (!temporaryUrl) throw new Error('QuickBooks returned an empty attachment download URL')

  const guarded = createSsrfGuardedFetchWithDispatcher({
    profile: 'contentFetch',
    maxResponseSize: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
  })
  const transferSignal = quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS)
  let downloadResponse: Response
  let buffer: Buffer
  try {
    downloadResponse = await guarded.fetch(temporaryUrl, {
      method: 'GET',
      headers: { Accept: '*/*' },
      signal: transferSignal,
    })
    if (!downloadResponse.ok) {
      throw await getQuickBooksDocumentError(downloadResponse, transferSignal)
    }
    assertContentLengthWithinLimit(
      downloadResponse.headers,
      QUICKBOOKS_MAX_ATTACHMENT_BYTES,
      'QuickBooks attachment file'
    )
    buffer = await readResponseToBufferWithLimit(downloadResponse, {
      maxBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
      label: 'QuickBooks attachment file',
      signal: transferSignal,
    })
  } finally {
    await guarded.dispatcher.close()
  }
  if (buffer.length === 0) throw new Error('QuickBooks attachment file is empty')

  const fallbackName = `quickbooks-attachment-${body.attachmentId}`

  return {
    buffer,
    mimeType:
      downloadResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ||
      'application/octet-stream',
    fileName: sanitizeQuickBooksFileName(
      body.fileName ?? undefined,
      contentDispositionFileName(downloadResponse.headers.get('content-disposition')) ||
        fallbackName
    ),
  }
}

async function downloadQuickBooksTransactionPdf(
  body: Extract<QuickBooksDownloadDocumentBody, { documentKind: 'transaction_pdf' }>,
  signal: AbortSignal
): Promise<DownloadedDocument> {
  const fileName = sanitizeQuickBooksFileName(
    body.fileName ?? undefined,
    `quickbooks-${body.transactionType.replaceAll('_', '-')}-${body.transactionId}.pdf`
  )
  if (!fileName.toLowerCase().endsWith('.pdf')) throw new Error('PDF filename must end in .pdf')

  const { resource } = getQuickBooksDocumentTransaction(body.transactionType)
  const url = buildQuickBooksCompanyUrl(
    body.realmId,
    `${resource}/${encodeURIComponent(body.transactionId)}/pdf`,
    body.quickBooksEnvironment
  )
  const transferSignal = quickBooksDocumentSignal(signal, QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS)
  const response = await fetch(url, {
    method: 'GET',
    headers: { ...buildQuickBooksHeaders(body.accessToken), Accept: 'application/pdf' },
    signal: transferSignal,
  })
  if (!response.ok) throw await getQuickBooksDocumentError(response, transferSignal)

  const mimeType =
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mimeType !== 'application/pdf') throw new Error('QuickBooks returned a non-PDF response')
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
    label: 'QuickBooks transaction PDF',
    signal: transferSignal,
  })
  if (buffer.length === 0) throw new Error('QuickBooks returned an empty PDF')
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('QuickBooks returned malformed PDF content')
  }
  return { buffer, mimeType, fileName }
}

export async function executeQuickBooksAddAttachment(
  data: QuickBooksAddAttachmentBody,
  context: QuickBooksOperationContext
) {
  context.signal.throwIfAborted()
  const url = buildQuickBooksCompanyUrl(
    data.realmId,
    data.attachmentKind === 'file' ? 'upload' : 'attachable',
    data.quickBooksEnvironment
  )
  let response: Response

  if (data.attachmentKind === 'note') {
    const metadata = buildQuickBooksAttachableMetadata(data.targetType, data.targetId, {
      note: data.note!,
    })
    response = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildQuickBooksHeaders(data.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
      signal: quickBooksDocumentSignal(context.signal, QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS),
    })
  } else {
    const rawFile = assertSingleQuickBooksFile(data.file ?? undefined)
    const files = processFilesToUserFiles([rawFile], context.requestId, logger)
    if (files.length !== 1) throw new Error('Exactly one valid file is required')
    const file = files[0]
    assertKnownSizeWithinLimit(
      file.size,
      QUICKBOOKS_MAX_ATTACHMENT_BYTES,
      'QuickBooks attachment file'
    )
    const resolvedName = sanitizeQuickBooksFileName(data.fileName ?? undefined, file.name)
    assertQuickBooksAttachmentExtension(resolvedName)
    const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
    if (denied) await errorFromResponse(denied, 'Unable to access QuickBooks attachment file')

    let downloaded: Awaited<ReturnType<typeof downloadServableFileFromStorage>>
    try {
      downloaded = await downloadServableFileFromStorage(file, context.requestId, logger, {
        maxBytes: QUICKBOOKS_MAX_ATTACHMENT_BYTES,
        signal: context.signal,
      })
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) await errorFromResponse(notReady, 'QuickBooks attachment file is not ready')
      throw error
    }
    context.signal.throwIfAborted()
    assertKnownSizeWithinLimit(
      downloaded.buffer.length,
      QUICKBOOKS_MAX_ATTACHMENT_BYTES,
      'QuickBooks attachment file'
    )
    if (downloaded.buffer.length === 0) {
      throw new Error('QuickBooks attachment file cannot be empty')
    }

    const storedMime = (downloaded.contentType || file.type || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    const requestedMime = data.contentType?.trim().toLowerCase() || storedMime
    const mimeType = validateQuickBooksAttachmentFileType(resolvedName, requestedMime)
    if (data.contentType && storedMime && requestedMime !== storedMime) {
      validateQuickBooksAttachmentFileType(resolvedName, storedMime)
    }

    const metadata = buildQuickBooksAttachableMetadata(data.targetType, data.targetId, {
      fileName: resolvedName,
      contentType: mimeType,
      description: data.description ?? undefined,
    })
    const formData = new FormData()
    formData.append(
      'file_metadata_01',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
      'attachment.json'
    )
    formData.append(
      'file_content_01',
      new Blob(
        [
          new Uint8Array(
            downloaded.buffer.buffer as ArrayBuffer,
            downloaded.buffer.byteOffset,
            downloaded.buffer.byteLength
          ),
        ],
        { type: mimeType }
      ),
      resolvedName
    )
    response = await fetch(url, {
      method: 'POST',
      headers: buildQuickBooksHeaders(data.accessToken),
      body: formData,
      signal: quickBooksDocumentSignal(context.signal, QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS),
    })
  }

  if (!response.ok) throw await getQuickBooksDocumentError(response, context.signal)
  const transformed = await parseQuickBooksAttachableResponse(response, context.signal)
  return {
    attachment: transformed.attachment,
    attachmentId: transformed.attachment.Id.trim(),
    attachmentKind: data.attachmentKind,
    targetType: data.targetType,
    targetId: data.targetId,
    time: transformed.time,
  }
}

export async function executeQuickBooksDownloadDocument(
  body: QuickBooksDownloadDocumentBody,
  context: QuickBooksOperationContext
) {
  context.signal.throwIfAborted()
  const downloaded =
    body.documentKind === 'attachment'
      ? await downloadQuickBooksAttachment(body, context.signal)
      : await downloadQuickBooksTransactionPdf(body, context.signal)

  context.signal.throwIfAborted()
  const executionContext =
    context.workspaceId && context.workflowId && context.executionId
      ? {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        }
      : null
  const storedFile = userFileSchema.parse(
    executionContext
      ? await uploadExecutionFile(
          executionContext,
          downloaded.buffer,
          downloaded.fileName,
          downloaded.mimeType,
          context.userId
        )
      : await uploadCopilotFile({
          buffer: downloaded.buffer,
          fileName: downloaded.fileName,
          contentType: downloaded.mimeType,
          userId: context.userId,
        })
  )

  const shared = {
    file: storedFile,
    fileName: downloaded.fileName,
    mimeType: downloaded.mimeType,
    size: downloaded.buffer.length,
  }
  return body.documentKind === 'attachment'
    ? { ...shared, attachmentId: body.attachmentId }
    : {
        ...shared,
        transactionType: body.transactionType,
        transactionId: body.transactionId,
      }
}
