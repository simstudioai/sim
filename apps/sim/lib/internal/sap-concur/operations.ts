import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  isPayloadSizeLimitError,
  MAX_MULTIPART_OVERHEAD_BYTES,
  type PayloadSizeLimitError,
} from '@/lib/core/utils/stream-limits'
import {
  assertSafeExternalUrl,
  extractSapConcurError,
  fetchSapConcurAccessToken,
  invokeSapConcur,
  invokeSapConcurMultipart,
  type SapConcurInvocation,
} from '@/lib/internal/sap-concur/client'
import type { SapConcurApiInput, SapConcurUploadInput } from '@/lib/internal/sap-concur/schema'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('SapConcurOperations')

const RECEIPT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/tiff',
  'image/tif',
])

const QUICK_EXPENSE_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/tif',
])

const ALL_ALLOWED_MIME_TYPES = RECEIPT_ALLOWED_MIME_TYPES
const MAX_RECEIPT_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_QUICK_EXPENSE_IMAGE_BYTES = 50 * 1024 * 1024
const UNKNOWN_MIME_TYPE = 'application/octet-stream'
const MIME_TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/tif': 'image/tiff',
}

export interface SapConcurOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

export interface SapConcurOperationErrorBody {
  success: false
  error: string
  status?: number
}

export class SapConcurOperationError extends Error {
  constructor(
    readonly status: number,
    readonly body: SapConcurOperationErrorBody,
    readonly headers: HeadersInit = {}
  ) {
    super(body.error)
    this.name = 'SapConcurOperationError'
  }
}

function clampErrorStatus(status: number): number {
  return status >= 400 ? status : 502
}

export interface SapConcurOperationResult {
  body: {
    success: true
    output: { status: number; data: unknown }
  }
  headers: HeadersInit
}

function resultFromInvocation(invocation: SapConcurInvocation): SapConcurOperationResult {
  if (invocation.status >= 200 && invocation.status < 300) {
    return {
      body: {
        success: true,
        output: {
          status: invocation.status,
          data: invocation.status === 204 ? null : invocation.body,
        },
      },
      headers: invocation.headers,
    }
  }

  const message = extractSapConcurError(invocation.body, invocation.status)
  throw new SapConcurOperationError(
    clampErrorStatus(invocation.status),
    { success: false, error: message, status: invocation.status },
    invocation.headers
  )
}

export async function executeSapConcurApiOperation(
  input: SapConcurApiInput,
  context: SapConcurOperationContext
) {
  context.signal?.throwIfAborted()
  const token = await fetchSapConcurAccessToken(input, context.requestId, context.signal)
  context.signal?.throwIfAborted()
  const invocation = await invokeSapConcur(
    input,
    token.accessToken,
    token.geolocation,
    context.signal
  )
  context.signal?.throwIfAborted()
  return resultFromInvocation(invocation)
}

function maxImageBytesForOperation(operation: SapConcurUploadInput['operation']): number {
  return operation === 'create_quick_expense_with_image'
    ? MAX_QUICK_EXPENSE_IMAGE_BYTES
    : MAX_RECEIPT_IMAGE_BYTES
}

function uploadSizeError(bytes: number, maxBytes: number): SapConcurOperationError {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  const limitMB = Math.round(maxBytes / (1024 * 1024))
  return new SapConcurOperationError(400, {
    success: false,
    error: `File size (${sizeMB}MB) exceeds Concur upload limit of ${limitMB}MB`,
  })
}

function unsupportedMimeTypeError(mimeType: string, allowedLabel: string): SapConcurOperationError {
  return new SapConcurOperationError(400, {
    success: false,
    error: `Unsupported receipt mime type: ${mimeType}. Allowed: ${allowedLabel}`,
  })
}

function inferMimeType(name: string, declared?: string): string {
  if (declared && ALL_ALLOWED_MIME_TYPES.has(declared.toLowerCase())) {
    const lowerDeclared = declared.toLowerCase()
    return MIME_TYPE_ALIASES[lowerDeclared] ?? lowerDeclared
  }
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return UNKNOWN_MIME_TYPE
}

async function responseBody(response: Response): Promise<SapConcurOperationErrorBody> {
  try {
    return (await response.json()) as SapConcurOperationErrorBody
  } catch {
    return { success: false, error: response.statusText || 'File operation failed' }
  }
}

async function operationErrorFromResponse(response: Response): Promise<SapConcurOperationError> {
  return new SapConcurOperationError(
    response.status,
    await responseBody(response),
    response.headers
  )
}

async function resolveUploadFile(
  input: SapConcurUploadInput,
  context: SapConcurOperationContext
): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  if (!context.userId) {
    throw new SapConcurOperationError(401, {
      success: false,
      error: 'Authentication required',
    })
  }
  context.signal?.throwIfAborted()
  const userFiles = processFilesToUserFiles(
    [input.receipt as RawFileInput],
    context.requestId,
    logger
  )
  if (userFiles.length === 0) {
    throw new SapConcurOperationError(400, {
      success: false,
      error: 'Invalid receipt file input',
    })
  }
  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) throw await operationErrorFromResponse(denied)

  const maxBytes = maxImageBytesForOperation(input.operation)
  const allowedForOperation =
    input.operation === 'create_quick_expense_with_image'
      ? QUICK_EXPENSE_ALLOWED_MIME_TYPES
      : RECEIPT_ALLOWED_MIME_TYPES
  const allowedLabel =
    input.operation === 'create_quick_expense_with_image'
      ? 'pdf, png, jpeg, tiff'
      : 'pdf, png, jpeg, gif, tiff'

  if (userFile.size > maxBytes) throw uploadSizeError(userFile.size, maxBytes)
  const declaredMimeType = inferMimeType(userFile.name, userFile.type)
  if (declaredMimeType !== UNKNOWN_MIME_TYPE && !allowedForOperation.has(declaredMimeType)) {
    throw unsupportedMimeTypeError(declaredMimeType, allowedLabel)
  }

  try {
    const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes,
      signal: context.signal,
    })
    context.signal?.throwIfAborted()
    if (resolved.buffer.length > maxBytes) {
      throw uploadSizeError(resolved.buffer.length, maxBytes)
    }
    const mimeType = inferMimeType(userFile.name, resolved.contentType || userFile.type)
    if (!allowedForOperation.has(mimeType)) {
      throw unsupportedMimeTypeError(mimeType, allowedLabel)
    }
    return { buffer: resolved.buffer, name: userFile.name, mimeType }
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof SapConcurOperationError) throw error
    const notReady = docNotReadyResponse(error)
    if (notReady) throw await operationErrorFromResponse(notReady)
    if (isPayloadSizeLimitError(error)) {
      throw uploadSizeError(
        (error as PayloadSizeLimitError).observedBytes ?? userFile.size,
        maxBytes
      )
    }
    logger.error('Failed to download Concur receipt file', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    throw new SapConcurOperationError(500, {
      success: false,
      error: getErrorMessage(error, 'Unknown error'),
    })
  }
}

function stringifyMaybeJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

function buildUploadForm(
  input: SapConcurUploadInput,
  file: { buffer: Buffer; name: string; mimeType: string }
): { urlPath: string; formData: FormData } {
  const fileBytes = new Uint8Array(file.buffer)
  const formData = new FormData()
  if (input.operation === 'upload_receipt_image') {
    formData.append('image', new Blob([fileBytes], { type: file.mimeType }), file.name)
    return {
      urlPath: `/receipts/v4/users/${encodeURIComponent(input.userId)}/image-only-receipts`,
      formData,
    }
  }

  const contextType = input.contextType?.trim() || 'TRAVELER'
  formData.append('quickExpenseRequest', stringifyMaybeJson(input.body ?? {}))
  formData.append('fileContent', new Blob([fileBytes], { type: file.mimeType }), file.name)
  return {
    urlPath: `/quickexpense/v4/users/${encodeURIComponent(input.userId)}/context/${encodeURIComponent(contextType)}/quickexpenses/image`,
    formData,
  }
}

export async function executeSapConcurUploadOperation(
  input: SapConcurUploadInput,
  context: SapConcurOperationContext
) {
  context.signal?.throwIfAborted()
  const file = await resolveUploadFile(input, context)
  context.signal?.throwIfAborted()
  const token = await fetchSapConcurAccessToken(input, context.requestId, context.signal)
  context.signal?.throwIfAborted()
  const upload = buildUploadForm(input, file)
  const url = assertSafeExternalUrl(
    `${token.geolocation.replace(/\/+$/, '')}${upload.urlPath}`,
    'apiUrl'
  ).toString()
  const invocation = await invokeSapConcurMultipart(
    url,
    token.accessToken,
    upload.formData,
    maxImageBytesForOperation(input.operation) +
      DEFAULT_MAX_JSON_BODY_BYTES +
      MAX_MULTIPART_OVERHEAD_BYTES,
    context.signal
  )
  context.signal?.throwIfAborted()
  logger.info('Concur upload succeeded', {
    operation: input.operation,
    requestId: context.requestId,
    status: invocation.status,
  })
  return resultFromInvocation(invocation)
}
