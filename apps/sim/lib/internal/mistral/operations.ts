import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import { isFileParserError } from '@/lib/file-parsers/errors'
import { submitMistralOcr } from '@/lib/internal/mistral/client'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import type { MistralParseInput } from '@/lib/internal/mistral/input'
import { MISTRAL_OCR_REQUEST_POLICY } from '@/lib/knowledge/documents/ocr-request-policy'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  extractStorageKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import {
  downloadServableFileFromStorage,
  resolveInternalFileUrl,
  type ServableFile,
} from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('MistralOperations')
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'] as const

export interface MistralOperationContext {
  /** Absolute ingestion deadline shared by admission, retries, and transport. */
  deadlineAt?: number
  headers: Headers
  maxResponseBytes?: number
  requestId: string
  signal?: AbortSignal
  trustedCaller?: 'knowledge-ingestion'
  userId?: string
}

function fileSizeError(): MistralOperationError {
  return new MistralOperationError(413, {
    success: false,
    error: `File exceeds Mistral OCR's ${MISTRAL_OCR_REQUEST_POLICY.maxBytes.toLocaleString()}-byte request limit`,
  })
}

function inferMimeType(type: string | undefined, name: string | undefined): string {
  if (type && type !== 'application/octet-stream') return type
  const filename = name?.toLowerCase() ?? ''
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg'
  if (filename.endsWith('.gif')) return 'image/gif'
  if (filename.endsWith('.webp')) return 'image/webp'
  return 'application/pdf'
}

async function buildInlineDocument(
  file: Exclude<MistralParseInput['file'], string | undefined>,
  context: MistralOperationContext
): Promise<Record<string, string>> {
  if (!context.userId && context.trustedCaller !== 'knowledge-ingestion') {
    throw new MistralOperationError(401, { success: false, error: 'Unauthorized' })
  }
  let userFile
  try {
    userFile = processSingleFileToUserFile(file, context.requestId, logger)
  } catch (error) {
    throw new MistralOperationError(400, {
      success: false,
      error: getErrorMessage(error, 'Failed to process file'),
    })
  }

  let mimeType = inferMimeType(userFile.type, userFile.name)
  let base64 = userFile.base64
  if (!base64) {
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId ?? '',
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) {
      throw new MistralOperationError(404, { success: false, error: 'File not found' })
    }
    if (!(await isModelSafeWorkspaceFileKey(userFile.key))) {
      throw new MistralOperationError(400, {
        success: false,
        error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
      })
    }
    context.signal?.throwIfAborted()
    let servableFile: ServableFile
    try {
      servableFile = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
        maxBytes: MISTRAL_OCR_REQUEST_POLICY.maxBytes,
      })
    } catch (error) {
      const { isPayloadSizeLimitError } = await import('@/lib/core/utils/stream-limits')
      if (isPayloadSizeLimitError(error)) throw fileSizeError()
      throw error
    }
    context.signal?.throwIfAborted()
    base64 = servableFile.buffer.toString('base64')
    if (servableFile.contentType && servableFile.contentType !== 'application/octet-stream') {
      mimeType = servableFile.contentType
    }
  }

  let inlineBytes: number
  try {
    inlineBytes = base64.startsWith('data:')
      ? decodeDataUriWithinLimit(base64, MISTRAL_OCR_REQUEST_POLICY.maxBytes).buffer.length
      : Buffer.byteLength(base64, 'base64')
  } catch (error) {
    if (isFileParserError(error) && error.code === 'complexity_limit') throw fileSizeError()
    throw new MistralOperationError(400, {
      success: false,
      error: getErrorMessage(error, 'Invalid inline file data'),
    })
  }
  if (inlineBytes > MISTRAL_OCR_REQUEST_POLICY.maxBytes) throw fileSizeError()

  const payload = base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${base64}`
  return mimeType.startsWith('image/')
    ? { type: 'image_url', image_url: payload }
    : { type: 'document_url', document_url: payload }
}

async function buildUrlDocument(
  filePath: string,
  context: MistralOperationContext
): Promise<Record<string, string>> {
  let fileUrl = filePath
  if (isInternalFileUrl(filePath)) {
    if (!context.userId) {
      throw new MistralOperationError(401, { success: false, error: 'Unauthorized' })
    }
    const resolution = await resolveInternalFileUrl(
      filePath,
      context.userId ?? '',
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (resolution.error) {
      throw new MistralOperationError(resolution.error.status, {
        success: false,
        error: resolution.error.message,
      })
    }
    fileUrl = resolution.fileUrl || fileUrl
    if (!(await isModelSafeWorkspaceFileKey(extractStorageKey(filePath)))) {
      throw new MistralOperationError(400, {
        success: false,
        error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
      })
    }
  } else if (filePath.startsWith('/')) {
    throw new MistralOperationError(400, {
      success: false,
      error: 'Invalid file path. Only uploaded files are supported for internal paths.',
    })
  } else {
    const { validateUrlWithDNS } = await import('@/lib/core/security/input-validation.server')
    const validation = await validateUrlWithDNS(fileUrl, 'filePath', 'contentFetch')
    context.signal?.throwIfAborted()
    if (!validation.isValid) {
      throw new MistralOperationError(400, { success: false, error: validation.error })
    }
  }

  const pathname = new URL(fileUrl).pathname.toLowerCase()
  return IMAGE_EXTENSIONS.some((extension) => pathname.endsWith(extension))
    ? { type: 'image_url', image_url: fileUrl }
    : { type: 'document_url', document_url: fileUrl }
}

export async function executeMistralParse(
  input: MistralParseInput,
  context: MistralOperationContext
): Promise<{ success: true; output: unknown }> {
  context.signal?.throwIfAborted()
  if (!context.userId && context.trustedCaller !== 'knowledge-ingestion') {
    throw new MistralOperationError(401, { success: false, error: 'Unauthorized' })
  }
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new MistralOperationError(provenance.status, {
      success: false,
      error: provenance.error,
    })
  }

  const fileData = input.file || input.fileData
  const filePath = typeof fileData === 'string' ? fileData : input.filePath
  if (!fileData && (!filePath || filePath.trim() === '')) {
    throw new MistralOperationError(400, { success: false, error: 'File input is required' })
  }

  const body: Record<string, unknown> = { model: 'mistral-ocr-latest' }
  if (fileData && typeof fileData === 'object') {
    body.document = await buildInlineDocument(fileData, context)
  } else if (filePath) {
    body.document = await buildUrlDocument(filePath, context)
  }
  if (input.pages) body.pages = input.pages
  if (input.includeImageBase64 !== undefined) {
    body.include_image_base64 = input.includeImageBase64
  }
  if (input.imageLimit) body.image_limit = input.imageLimit
  if (input.imageMinSize) body.image_min_size = input.imageMinSize

  const output = await submitMistralOcr(
    input.apiKey,
    body,
    context.signal,
    context.maxResponseBytes,
    context.deadlineAt
  )
  context.signal?.throwIfAborted()
  return { success: true, output }
}
