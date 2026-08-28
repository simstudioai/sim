import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { analyzeVision, type VisionAnalysisResult } from '@/lib/internal/vision/client'
import { VisionOperationError } from '@/lib/internal/vision/errors'
import type { VisionOperationInput } from '@/lib/internal/vision/schema'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  extractStorageKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('VisionOperations')
const DEFAULT_PROMPT = 'Please analyze this image and describe what you see in detail.'

export interface VisionOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
}

interface ResolvedImage {
  source: string
  contentType?: string
  resolvedIP?: string
}

function fail(message: string, status: number, body?: Record<string, unknown>): never {
  throw new VisionOperationError(message, status, body)
}

async function resolveFileImage(
  input: VisionOperationInput,
  context: VisionOperationContext
): Promise<ResolvedImage | null> {
  if (!input.imageFile) return null
  let file
  try {
    file = processSingleFileToUserFile(input.imageFile, context.requestId, logger)
  } catch (error) {
    fail(getErrorMessage(error, 'Failed to process image file'), 400)
  }

  let base64 = file.base64
  if (!base64) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) {
      fail('File not found', denied.status, (await denied.json()) as Record<string, unknown>)
    }
    if (!(await isModelSafeWorkspaceFileKey(file.key))) {
      fail(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
    }
    context.signal?.throwIfAborted()
    const buffer = await downloadFileFromStorage(file, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    context.signal?.throwIfAborted()
    base64 = buffer.toString('base64')
  }
  const contentType = file.type || 'image/jpeg'
  return { source: `data:${contentType};base64,${base64}`, contentType }
}

async function resolveUrlImage(
  input: VisionOperationInput,
  context: VisionOperationContext
): Promise<ResolvedImage> {
  let source = input.imageUrl || ''
  if (source.startsWith('data:')) return { source }
  if (source.startsWith('/') && !isInternalFileUrl(source)) {
    fail('Invalid file path. Only uploaded files are supported for internal paths.', 400)
  }
  if (isInternalFileUrl(source)) {
    context.signal?.throwIfAborted()
    const resolution = await resolveInternalFileUrl(
      source,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (resolution.error) fail(resolution.error.message, resolution.error.status)
    source = resolution.fileUrl || source
    if (!(await isModelSafeWorkspaceFileKey(extractStorageKey(input.imageUrl!)))) {
      fail(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
    }
  }

  context.signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(source, 'imageUrl')
  context.signal?.throwIfAborted()
  if (!validation.isValid) {
    fail(validation.error || 'Invalid image URL', 400, {
      success: false,
      error: validation.error,
    })
  }
  return { source, resolvedIP: validation.resolvedIP }
}

export async function executeVisionOperation(
  input: VisionOperationInput,
  context: VisionOperationContext
): Promise<VisionAnalysisResult> {
  context.signal?.throwIfAborted()
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) fail(provenance.error, provenance.status)
  if (!input.imageUrl && !input.imageFile) {
    fail('Either imageUrl or imageFile is required', 400)
  }

  const image = (await resolveFileImage(input, context)) ?? (await resolveUrlImage(input, context))
  context.signal?.throwIfAborted()
  return analyzeVision(
    {
      apiKey: input.apiKey,
      imageSource: image.source,
      imageContentType: image.contentType,
      model: input.model,
      prompt: input.prompt || DEFAULT_PROMPT,
      remoteImageResolvedIP: image.resolvedIP,
    },
    context.signal
  )
}
