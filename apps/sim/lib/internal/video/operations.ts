import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import {
  generateVideo,
  getVideoInputValidationError,
  type VideoGenerationInput,
} from '@/lib/internal/video/client'
import { VideoOperationError } from '@/lib/internal/video/errors'
import { StorageService } from '@/lib/uploads'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoOperations')

export interface VideoOperationInput extends VideoGenerationInput {
  visualReference?: UserFile
}

export interface VideoOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export interface VideoOperationResult {
  videoUrl: string
  videoFile?: UserFile
  duration?: number
  width?: number
  height?: number
  provider: VideoOperationInput['provider']
  model: string
  jobId?: string
  __falaiCostDollars?: number
  __falaiBilling?: unknown
}

async function authorizeVisualReference(
  input: VideoOperationInput,
  context: VideoOperationContext
): Promise<void> {
  const file = input.visualReference
  if (!file) return
  context.signal?.throwIfAborted()
  const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) {
    const body = (await denied.json()) as Record<string, unknown>
    throw new VideoOperationError('File not found', denied.status, body)
  }
  if (!(await isModelSafeWorkspaceFileKey(file.key))) {
    throw new VideoOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
  }
  context.signal?.throwIfAborted()
}

function validateModelInputProvenance(
  input: VideoOperationInput,
  context: VideoOperationContext
): void {
  if (input.provider !== 'runway') return
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new VideoOperationError(provenance.error, provenance.status)
  }
}

async function storeVideo(
  input: VideoOperationInput,
  buffer: Buffer,
  context: VideoOperationContext
): Promise<{ videoUrl: string; videoFile?: UserFile }> {
  context.signal?.throwIfAborted()
  const fileName = `video-${input.provider}-${Date.now()}.mp4`
  try {
    if (context.workspaceId && context.workflowId && context.executionId) {
      const videoFile = await uploadExecutionFile(
        {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        },
        buffer,
        fileName,
        'video/mp4',
        context.userId
      )
      context.signal?.throwIfAborted()
      logger.info('Stored generated video in execution context', {
        requestId: context.requestId,
        provider: input.provider,
        executionId: context.executionId,
        size: videoFile.size,
      })
      return { videoUrl: videoFile.url, videoFile }
    }

    const file = await StorageService.uploadFile({
      file: buffer,
      fileName,
      contentType: 'video/mp4',
      context: 'copilot',
    })
    context.signal?.throwIfAborted()
    logger.info('Stored generated video in copilot context', {
      requestId: context.requestId,
      provider: input.provider,
      size: file.size,
    })
    return { videoUrl: `${getBaseUrl()}${file.path}` }
  } catch (error) {
    context.signal?.throwIfAborted()
    throw new VideoOperationError(
      `Failed to store video: ${getErrorMessage(error, 'Unknown error')}`,
      500
    )
  }
}

export async function executeVideoOperation(
  input: VideoOperationInput,
  context: VideoOperationContext
): Promise<VideoOperationResult> {
  context.signal?.throwIfAborted()
  validateModelInputProvenance(input, context)
  const validationError = getVideoInputValidationError(input)
  if (validationError) throw new VideoOperationError(validationError, 400)
  await authorizeVisualReference(input, context)

  const generated = await generateVideo(input, {
    requestId: context.requestId,
    signal: context.signal,
  })
  context.signal?.throwIfAborted()
  const stored = await storeVideo(input, generated.buffer, context)

  return {
    ...stored,
    duration: generated.duration || input.duration,
    width: generated.width,
    height: generated.height,
    provider: input.provider,
    model: input.model || 'default',
    jobId: generated.jobId,
    __falaiCostDollars: generated.falaiCost?.costDollars,
    __falaiBilling: generated.falaiCost,
  }
}
