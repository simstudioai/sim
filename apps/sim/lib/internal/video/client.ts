import { createLogger, type Logger } from '@sim/logger'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  PayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { buildFalVideoRequest, getFalAIValidationError } from '@/lib/internal/video/fal-request'
import { getFalVideoModel } from '@/lib/media/fal-video-catalog'
import { downloadFalMedia } from '@/lib/media/falai'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoProviderClient')
const MAX_VIDEO_OUTPUT_BYTES = 250 * 1024 * 1024
const MAX_VIDEO_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_VIDEO_JSON_BYTES = 2 * 1024 * 1024
const POLL_INTERVAL_MS = 5000

export type VideoProvider = 'runway' | 'veo' | 'luma' | 'minimax' | 'falai'

export interface VideoGenerationInput {
  provider: VideoProvider
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  visualReference?: UserFile
  cameraControl?: unknown
  endpoint?: string
  promptOptimizer?: boolean
  generateAudio?: boolean
  useHostedCostTracking?: boolean
}

export interface VideoGenerationResult {
  buffer: Buffer
  width?: number
  height?: number
  jobId?: string
  duration?: number
  falaiCost?: FalAICostMetadata
}

export interface VideoGenerationContext {
  onFalCost?: (receipt: FalAICostMetadata) => void
  requestId: string
  signal?: AbortSignal
}

async function readVideoResponseBuffer(response: Response, label: string): Promise<Buffer> {
  return readResponseToBufferWithLimit(response, {
    maxBytes: MAX_VIDEO_OUTPUT_BYTES,
    label,
  })
}

async function readVideoJson<T = Record<string, unknown>>(
  response: Response,
  label: string
): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: MAX_VIDEO_JSON_BYTES,
    label,
  })
}

async function readVideoErrorText(response: Response, label: string): Promise<string> {
  return readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label,
  }).catch(() => '')
}

async function waitForProvider(context: VideoGenerationContext): Promise<void> {
  await interruptibleSleep(POLL_INTERVAL_MS, context.signal)
  context.signal?.throwIfAborted()
}

export function getVideoInputValidationError(input: VideoGenerationInput): string | undefined {
  if (input.prompt.length < 3 || input.prompt.length > 2000) {
    return 'Prompt must be between 3 and 2000 characters'
  }
  if (
    input.provider === 'veo' &&
    input.duration !== undefined &&
    ![4, 6, 8].includes(input.duration)
  ) {
    return 'Duration must be 4, 6, or 8 seconds for Veo'
  }
  if (
    input.provider === 'minimax' &&
    input.duration !== undefined &&
    ![6, 10].includes(input.duration)
  ) {
    return 'Duration must be 6 or 10 seconds for MiniMax'
  }
  if (
    input.provider !== 'falai' &&
    input.provider !== 'veo' &&
    input.provider !== 'minimax' &&
    input.duration !== undefined &&
    (input.duration < 5 || input.duration > 10)
  ) {
    return 'Duration must be between 5 and 10 seconds'
  }
  if (input.provider !== 'falai' && input.aspectRatio) {
    const valid = input.provider === 'veo' ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1']
    if (!valid.includes(input.aspectRatio)) return `Aspect ratio must be ${valid.join(', ')}`
  }
  if (input.provider === 'falai') {
    return getFalAIValidationError(input)
  }
  return undefined
}

export async function generateVideo(
  input: VideoGenerationInput,
  context: VideoGenerationContext
): Promise<VideoGenerationResult> {
  context.signal?.throwIfAborted()
  logger.info(`[${context.requestId}] Generating video with ${input.provider}`, {
    model: input.model || 'default',
  })
  switch (input.provider) {
    case 'runway':
      return generateWithRunway(
        input.apiKey,
        input.prompt,
        input.duration || 5,
        input.aspectRatio || '16:9',
        input.resolution || '1080p',
        input.visualReference,
        context,
        logger
      )
    case 'veo':
      return generateWithVeo(
        input.apiKey,
        input.model || 'veo-3',
        input.prompt,
        input.duration || 8,
        input.aspectRatio || '16:9',
        input.resolution || '1080p',
        context,
        logger
      )
    case 'luma':
      return generateWithLuma(
        input.apiKey,
        input.model || 'ray-2',
        input.prompt,
        input.duration || 5,
        input.aspectRatio || '16:9',
        input.resolution || '1080p',
        input.cameraControl,
        context,
        logger
      )
    case 'minimax':
      return generateWithMiniMax(
        input.apiKey,
        input.model || 'hailuo-2.3',
        input.prompt,
        input.duration || 6,
        input.promptOptimizer !== false,
        input.endpoint,
        context,
        logger
      )
    case 'falai':
      return generateWithFalAI(input, context)
  }
}

async function generateWithRunway(
  apiKey: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  resolution: string,
  visualReference: UserFile | undefined,
  context: VideoGenerationContext,
  logger: Logger
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] Starting Runway Gen-4 generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  const ratioMap: Record<string, string> = {
    '16:9': '1280:720',
    '9:16': '720:1280',
    '1:1': '960:960',
  }
  const runwayRatio = ratioMap[aspectRatio] || '1280:720'

  const createPayload: Record<string, unknown> = {
    promptText: prompt,
    duration,
    ratio: runwayRatio,
    model: 'gen4_turbo',
  }

  if (visualReference) {
    if (visualReference.size > MAX_VIDEO_REFERENCE_IMAGE_BYTES) {
      throw new PayloadSizeLimitError({
        label: 'video visual reference',
        maxBytes: MAX_VIDEO_REFERENCE_IMAGE_BYTES,
        observedBytes: visualReference.size,
      })
    }
    const refBuffer = await downloadFileFromStorage(visualReference, requestId, logger, {
      maxBytes: MAX_VIDEO_REFERENCE_IMAGE_BYTES,
    })
    assertKnownSizeWithinLimit(
      refBuffer.length,
      MAX_VIDEO_REFERENCE_IMAGE_BYTES,
      'video visual reference'
    )
    const refBase64 = refBuffer.toString('base64')
    createPayload.promptImage = `data:${visualReference.type};base64,${refBase64}`
  }

  const createResponse = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify(createPayload),
    signal,
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Runway create error response')
    throw new Error(`Runway API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ id: string }>(createResponse, 'Runway create response')
  const taskId = createData.id

  logger.info(`[${requestId}] Runway task created: ${taskId}`)

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  let attempts = 0

  while (attempts < maxAttempts) {
    await waitForProvider(context)

    const statusResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      signal,
    })

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'Runway status error response')
      throw new Error(`Runway status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<{
      status?: string
      output?: string[]
      failure?: string
    }>(statusResponse, 'Runway status response')

    if (statusData.status === 'SUCCEEDED') {
      logger.info(`[${requestId}] Runway generation completed after ${attempts * 5}s`)

      const videoUrl = statusData.output?.[0]
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const videoResponse = await fetch(videoUrl, { signal })
      if (!videoResponse.ok) {
        await readVideoErrorText(videoResponse, 'Runway video error response')
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      return {
        buffer: await readVideoResponseBuffer(videoResponse, 'Runway video response'),
        width: dimensions.width,
        height: dimensions.height,
        jobId: taskId,
        duration,
      }
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`Runway generation failed: ${statusData.failure || 'Unknown error'}`)
    }

    attempts++
  }

  throw new Error('Runway generation timed out')
}

async function generateWithVeo(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  resolution: string,
  context: VideoGenerationContext,
  logger: Logger
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] Starting Google Veo generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  const modelNameMap: Record<string, string> = {
    'veo-3': 'veo-3.0-generate-001',
    'veo-3-fast': 'veo-3.0-fast-generate-001',
    'veo-3.1': 'veo-3.1-generate-preview',
  }
  const modelName = modelNameMap[model] || 'veo-3.1-generate-preview'

  const createPayload = {
    instances: [
      {
        prompt,
      },
    ],
    parameters: {
      aspectRatio,
      resolution: resolution,
      durationSeconds: duration,
    },
  }

  const createResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predictLongRunning`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(createPayload),
      signal,
    }
  )

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Veo create error response')
    throw new Error(`Veo API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ name: string }>(createResponse, 'Veo create response')
  const operationName = createData.name

  logger.info(`[${requestId}] Veo operation created: ${operationName}`)

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  let attempts = 0

  while (attempts < maxAttempts) {
    await waitForProvider(context)

    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      {
        headers: {
          'x-goog-api-key': apiKey,
        },
        signal,
      }
    )

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'Veo status error response')
      throw new Error(`Veo status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<{
      done?: boolean
      error?: { message?: string }
      response?: {
        generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> }
      }
    }>(statusResponse, 'Veo status response')

    if (statusData.done) {
      if (statusData.error) {
        throw new Error(`Veo generation failed: ${statusData.error.message}`)
      }

      logger.info(`[${requestId}] Veo generation completed after ${attempts * 5}s`)

      const videoUri = statusData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      if (!videoUri) {
        throw new Error('No video URI in response')
      }

      const videoResponse = await fetch(videoUri, {
        headers: {
          'x-goog-api-key': apiKey,
        },
        signal,
      })

      if (!videoResponse.ok) {
        await readVideoErrorText(videoResponse, 'Veo video error response')
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      return {
        buffer: await readVideoResponseBuffer(videoResponse, 'Veo video response'),
        width: dimensions.width,
        height: dimensions.height,
        jobId: operationName,
        duration,
      }
    }

    attempts++
  }

  throw new Error('Veo generation timed out')
}

async function generateWithLuma(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  resolution: string,
  cameraControl: unknown,
  context: VideoGenerationContext,
  logger: Logger
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] Starting Luma Dream Machine generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  const createPayload: Record<string, unknown> = {
    prompt,
    model: model || 'ray-2',
    aspect_ratio: aspectRatio,
    loop: false,
  }

  if (duration) {
    createPayload.duration = `${duration}s`
  }

  if (resolution) {
    createPayload.resolution = resolution
  }

  if (cameraControl) {
    createPayload.concepts = Array.isArray(cameraControl) ? cameraControl : [{ key: cameraControl }]
  }

  const createResponse = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
    signal,
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Luma create error response')
    throw new Error(`Luma API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ id: string }>(createResponse, 'Luma create response')
  const generationId = createData.id

  logger.info(`[${requestId}] Luma generation created: ${generationId}`)

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  let attempts = 0

  while (attempts < maxAttempts) {
    await waitForProvider(context)

    const statusResponse = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
      }
    )

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'Luma status error response')
      throw new Error(`Luma status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<{
      state?: string
      failure_reason?: string
      assets?: { video?: string }
    }>(statusResponse, 'Luma status response')

    if (statusData.state === 'completed') {
      logger.info(`[${requestId}] Luma generation completed after ${attempts * 5}s`)

      const videoUrl = statusData.assets?.video
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const videoResponse = await fetch(videoUrl, { signal })
      if (!videoResponse.ok) {
        await readVideoErrorText(videoResponse, 'Luma video error response')
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      return {
        buffer: await readVideoResponseBuffer(videoResponse, 'Luma video response'),
        width: dimensions.width,
        height: dimensions.height,
        jobId: generationId,
        duration,
      }
    }

    if (statusData.state === 'failed') {
      throw new Error(`Luma generation failed: ${statusData.failure_reason || 'Unknown error'}`)
    }

    attempts++
  }

  throw new Error('Luma generation timed out')
}

async function generateWithMiniMax(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  promptOptimizer: boolean,
  endpoint: string | undefined,
  context: VideoGenerationContext,
  logger: Logger
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] Starting MiniMax Hailuo generation via MiniMax Platform API`)
  logger.info(
    `[${requestId}] Request params - model: ${model}, duration: ${duration}, endpoint: ${endpoint || 'standard'}, promptOptimizer: ${promptOptimizer}`
  )

  const useProResolution = endpoint === 'pro' && duration === 6
  const resolution = useProResolution ? '1080P' : '768P'
  const dimensions = useProResolution ? { width: 1920, height: 1080 } : { width: 1360, height: 768 }

  logger.info(
    `[${requestId}] Using resolution: ${resolution}, dimensions: ${dimensions.width}x${dimensions.height}`
  )

  const minimaxModel = model === 'hailuo-02' ? 'MiniMax-Hailuo-02' : 'MiniMax-Hailuo-2.3'

  const createResponse = await fetch('https://api.minimax.io/v1/video_generation', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: minimaxModel,
      prompt: prompt,
      duration: duration,
      resolution: resolution,
      prompt_optimizer: promptOptimizer,
    }),
    signal,
  })

  if (!createResponse.ok) {
    const errorText = await readVideoErrorText(createResponse, 'MiniMax create error response')
    if (createResponse.status === 401 || createResponse.status === 1004) {
      throw new Error(
        `MiniMax API authentication failed (${createResponse.status}). Please ensure you're using a valid MiniMax API key from platform.minimax.io. Error: ${errorText}`
      )
    }
    throw new Error(`MiniMax API error: ${createResponse.status} - ${errorText}`)
  }

  const createData = await readVideoJson<{
    base_resp?: { status_code?: number; status_msg?: string }
    task_id?: string
  }>(createResponse, 'MiniMax create response')

  if (createData.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax API error: ${createData.base_resp?.status_msg || 'Unknown error'}`)
  }

  const taskId = createData.task_id
  if (!taskId) {
    throw new Error('MiniMax response missing task_id')
  }

  logger.info(`[${requestId}] MiniMax task created: ${taskId}`)

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  let attempts = 0

  while (attempts < maxAttempts) {
    await waitForProvider(context)

    const statusResponse = await fetch(
      `https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
      }
    )

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'MiniMax status error response')
      throw new Error(`MiniMax status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<{
      base_resp?: { status_code?: number; status_msg?: string }
      status?: string
      file_id?: string
      error?: string
    }>(statusResponse, 'MiniMax status response')

    if (
      statusData.base_resp?.status_code !== 0 &&
      statusData.base_resp?.status_code !== undefined
    ) {
      throw new Error(
        `MiniMax status query error: ${statusData.base_resp?.status_msg || 'Unknown error'}`
      )
    }

    if (statusData.status === 'Success' || statusData.status === 'success') {
      logger.info(`[${requestId}] MiniMax generation completed after ${attempts * 5}s`)

      const fileId = statusData.file_id
      if (!fileId) {
        throw new Error('No file_id in response')
      }

      const fileResponse = await fetch(
        `https://api.minimax.io/v1/files/retrieve?file_id=${fileId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal,
        }
      )

      if (!fileResponse.ok) {
        await readVideoErrorText(fileResponse, 'MiniMax file error response')
        throw new Error(`Failed to download video: ${fileResponse.status}`)
      }

      const fileData = await readVideoJson<{ file?: { download_url?: string } }>(
        fileResponse,
        'MiniMax file response'
      )
      const videoUrl = fileData.file?.download_url

      if (!videoUrl) {
        throw new Error('No download URL in file response')
      }

      const videoResponse = await fetch(videoUrl, { signal })
      if (!videoResponse.ok) {
        await readVideoErrorText(videoResponse, 'MiniMax video error response')
        throw new Error(`Failed to download video from URL: ${videoResponse.status}`)
      }

      return {
        buffer: await readVideoResponseBuffer(videoResponse, 'MiniMax video response'),
        width: dimensions.width,
        height: dimensions.height,
        jobId: taskId,
        duration,
      }
    }

    if (statusData.status === 'Failed' || statusData.status === 'failed') {
      throw new Error(`MiniMax generation failed: ${statusData.error || 'Unknown error'}`)
    }

    attempts++
  }

  throw new Error('MiniMax generation timed out')
}

function getStringProperty(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function getNumberProperty(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function getFalAIErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecordLike(error)) return getStringProperty(error, 'message') || JSON.stringify(error)
  return 'Unknown error'
}

function falQueueUrl(url: string): string {
  if (new URL(url).origin !== 'https://queue.fal.run') {
    throw new Error('Invalid Fal.ai queue URL')
  }
  return url
}

async function generateWithFalAI(
  input: VideoGenerationInput,
  context: VideoGenerationContext
): Promise<VideoGenerationResult> {
  const { apiKey, model, duration, aspectRatio, resolution, useHostedCostTracking } = input
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] Starting Fal.ai generation with model: ${model}`)
  const { endpoint, body } = buildFalVideoRequest(input)
  const createResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Fal.ai create error response')
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<unknown>(createResponse, 'Fal.ai queue response')
  if (!isRecordLike(createData)) {
    throw new Error('Invalid Fal.ai queue response')
  }

  const requestIdFal = getStringProperty(createData, 'request_id')
  if (!requestIdFal) {
    throw new Error('Fal.ai queue response missing request_id')
  }

  const requestUrl = `https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestIdFal)}`
  const statusUrl = falQueueUrl(
    getStringProperty(createData, 'status_url') || `${requestUrl}/status`
  )
  const responseUrl = falQueueUrl(getStringProperty(createData, 'response_url') || requestUrl)

  logger.info(`[${requestId}] Fal.ai request created: ${requestIdFal}`)

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  let attempts = 0

  while (attempts < maxAttempts) {
    await waitForProvider(context)

    const statusResponse = await fetch(statusUrl, {
      redirect: 'error',
      headers: {
        Authorization: `Key ${apiKey}`,
      },
      signal,
    })

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'Fal.ai status error response')
      throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<unknown>(statusResponse, 'Fal.ai status response')
    if (!isRecordLike(statusData)) {
      throw new Error('Invalid Fal.ai status response')
    }

    if (getStringProperty(statusData, 'status') === 'COMPLETED') {
      const statusError = statusData.error
      if (statusError) {
        throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusError)}`)
      }

      logger.info(`[${requestId}] Fal.ai generation completed after ${attempts * 5}s`)

      const falaiCost = useHostedCostTracking
        ? await getFalAICostMetadata({ apiKey, endpointId: endpoint, requestId: requestIdFal })
        : undefined
      if (falaiCost) context.onFalCost?.(falaiCost)
      signal?.throwIfAborted()

      const resultResponse = await fetch(
        falQueueUrl(getStringProperty(statusData, 'response_url') || responseUrl),
        {
          redirect: 'error',
          headers: {
            Authorization: `Key ${apiKey}`,
          },
          signal,
        }
      )

      if (!resultResponse.ok) {
        await readVideoErrorText(resultResponse, 'Fal.ai result error response')
        throw new Error(`Failed to fetch result: ${resultResponse.status}`)
      }

      const resultData = await readVideoJson<unknown>(resultResponse, 'Fal.ai result response')
      if (!isRecordLike(resultData)) {
        throw new Error('Invalid Fal.ai result response')
      }

      const videoOutput = isRecordLike(resultData.video) ? resultData.video : undefined
      const fallbackOutput = isRecordLike(resultData.output) ? resultData.output : undefined
      const videoUrl =
        getStringProperty(videoOutput, 'url') || getStringProperty(fallbackOutput, 'url')
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const { buffer } = await downloadFalMedia(videoUrl, signal)
      const catalogModel = getFalVideoModel(model)
      const legacyMetadata = !catalogModel || catalogModel.legacyId === model
      let width = getNumberProperty(videoOutput, 'width')
      let height = getNumberProperty(videoOutput, 'height')
      if (legacyMetadata && !width && aspectRatio?.includes(':')) {
        const dims = getVideoDimensions(aspectRatio, resolution || '1080p')
        width = dims.width
        height = dims.height
      }

      return {
        buffer,
        width: width ?? (legacyMetadata ? 1920 : undefined),
        height: height ?? (legacyMetadata ? 1080 : undefined),
        jobId: requestIdFal,
        duration:
          getNumberProperty(videoOutput, 'duration') ??
          getNumberProperty(resultData, 'duration') ??
          duration ??
          (legacyMetadata ? 5 : undefined),
        falaiCost,
      }
    }

    if (['ERROR', 'FAILED', 'CANCELLED'].includes(getStringProperty(statusData, 'status') || '')) {
      throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusData.error)}`)
    }

    attempts++
  }

  throw new Error('Fal.ai generation timed out')
}

function getVideoDimensions(
  aspectRatio: string,
  resolution: string
): { width: number; height: number } {
  let height: number
  if (resolution === '4k' || resolution === '2160p') {
    height = 2160
  } else if (resolution === 'true_1080p') {
    height = 1080
  } else {
    const parsedHeight = Number.parseInt(resolution.replace('p', ''))
    height = Number.isFinite(parsedHeight) ? parsedHeight : 1080
  }

  const [ratioW, ratioH] = aspectRatio.split(':').map(Number)
  if (!Number.isFinite(ratioW) || !Number.isFinite(ratioH) || ratioH === 0) {
    return { width: Math.round((height * 16) / 9), height }
  }

  const width = Math.round((height * ratioW) / ratioH)

  return { width, height }
}
