import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { videoProviders, videoToolContract } from '@/lib/api/contracts/tools/media/video'
import { getValidationErrorMessage, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  PayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoProxyAPI')
const MAX_VIDEO_OUTPUT_BYTES = 250 * 1024 * 1024
const MAX_VIDEO_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_VIDEO_JSON_BYTES = 2 * 1024 * 1024

export const dynamic = 'force-dynamic'
/**
 * Mirrors the maximum plan execution timeout (enterprise async, 90 minutes) used by
 * `getMaxExecutionTimeout()` for the provider polling loops below. Next.js requires a
 * static literal for `maxDuration`, so this value must be kept in sync with that source.
 */
export const maxDuration = 5400

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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId()
  logger.info(`[${requestId}] Video generation request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      videoToolContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid video request:`, error.issues)
          return validationErrorResponse(
            error,
            getValidationErrorMessage(error, 'Invalid request data')
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const { provider, apiKey, model, prompt, duration, aspectRatio, resolution } = body

    const validProviders = videoProviders
    if (!validProviders.includes(provider as (typeof videoProviders)[number])) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      )
    }

    if (prompt.length < 3 || prompt.length > 2000) {
      return NextResponse.json(
        { error: 'Prompt must be between 3 and 2000 characters' },
        { status: 400 }
      )
    }

    // Validate duration (provider-specific constraints)
    if (provider === 'veo') {
      if (duration !== undefined && ![4, 6, 8].includes(duration)) {
        return NextResponse.json(
          { error: 'Duration must be 4, 6, or 8 seconds for Veo' },
          { status: 400 }
        )
      }
    } else if (provider === 'minimax') {
      if (duration !== undefined && ![6, 10].includes(duration)) {
        return NextResponse.json(
          { error: 'Duration must be 6 or 10 seconds for MiniMax' },
          { status: 400 }
        )
      }
    } else if (provider !== 'falai' && duration !== undefined && (duration < 5 || duration > 10)) {
      // Fal.ai has variable duration constraints per model, skip validation
      return NextResponse.json(
        { error: 'Duration must be between 5 and 10 seconds' },
        { status: 400 }
      )
    }

    if (provider !== 'falai') {
      const validAspectRatios = provider === 'veo' ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1']
      if (aspectRatio && !validAspectRatios.includes(aspectRatio)) {
        return NextResponse.json(
          { error: `Aspect ratio must be ${validAspectRatios.join(', ')}` },
          { status: 400 }
        )
      }
    }

    logger.info(`[${requestId}] Generating video with ${provider}, model: ${model || 'default'}`)

    let videoUrl: string
    let videoBuffer: Buffer
    let width: number | undefined
    let height: number | undefined
    let jobId: string | undefined
    let actualDuration: number | undefined
    let falaiCost: FalAICostMetadata | undefined

    if (body.visualReference) {
      const denied = await assertToolFileAccess(
        body.visualReference.key,
        authResult.userId,
        requestId,
        logger
      )
      if (denied) return denied
    }

    try {
      if (provider === 'runway') {
        const result = await generateWithRunway(
          apiKey,
          model || 'gen-4',
          prompt,
          duration || 5,
          aspectRatio || '16:9',
          resolution || '1080p',
          body.visualReference,
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
      } else if (provider === 'veo') {
        const result = await generateWithVeo(
          apiKey,
          model || 'veo-3',
          prompt,
          duration || 8, // Default to 8 seconds (valid: 4, 6, or 8)
          aspectRatio || '16:9',
          resolution || '1080p',
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
      } else if (provider === 'luma') {
        const result = await generateWithLuma(
          apiKey,
          model || 'ray-2',
          prompt,
          duration || 5,
          aspectRatio || '16:9',
          resolution || '1080p',
          body.cameraControl,
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
      } else if (provider === 'minimax') {
        const result = await generateWithMiniMax(
          apiKey,
          model || 'hailuo-2.3',
          prompt,
          duration || 6,
          body.promptOptimizer !== false,
          body.endpoint,
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
      } else if (provider === 'falai') {
        if (!model) {
          return NextResponse.json(
            { error: 'Model is required for Fal.ai provider' },
            { status: 400 }
          )
        }
        const validationError = getFalAIValidationError(model, duration, aspectRatio, resolution)
        if (validationError) {
          return NextResponse.json({ error: validationError }, { status: 400 })
        }
        const result = await generateWithFalAI(
          apiKey,
          model,
          prompt,
          duration,
          aspectRatio,
          resolution,
          body.promptOptimizer,
          body.generateAudio,
          body.useHostedCostTracking === true,
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
        falaiCost = result.falaiCost
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] Video generation failed:`, error)
      const errorMessage = getErrorMessage(error, 'Video generation failed')
      return NextResponse.json(
        { error: errorMessage },
        { status: isPayloadSizeLimitError(error) ? 413 : 500 }
      )
    }

    const executionContext =
      body.workspaceId && body.workflowId && body.executionId
        ? {
            workspaceId: body.workspaceId,
            workflowId: body.workflowId,
            executionId: body.executionId,
          }
        : null

    logger.info(`[${requestId}] Storing video file, size: ${videoBuffer.length} bytes`)

    if (executionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const timestamp = Date.now()
      const fileName = `video-${provider}-${timestamp}.mp4`

      let videoFile
      try {
        videoFile = await uploadExecutionFile(
          executionContext,
          videoBuffer,
          fileName,
          'video/mp4',
          authResult.userId
        )

        logger.info(`[${requestId}] Video stored successfully:`, {
          fileName,
          size: videoFile.size,
          executionId: body.executionId,
        })
      } catch (error) {
        logger.error(`[${requestId}] Failed to upload video file:`, error)
        throw new Error(`Failed to store video: ${getErrorMessage(error, 'Unknown error')}`)
      }

      return NextResponse.json({
        videoUrl: videoFile.url,
        videoFile,
        duration: actualDuration || duration,
        width,
        height,
        provider,
        model: model || 'default',
        jobId,
        __falaiCostDollars: falaiCost?.costDollars,
        __falaiBilling: falaiCost,
      })
    }

    const { StorageService } = await import('@/lib/uploads')
    const { getBaseUrl } = await import('@/lib/core/utils/urls')
    const timestamp = Date.now()
    const fileName = `video-${provider}-${timestamp}.mp4`

    try {
      const fileInfo = await StorageService.uploadFile({
        file: videoBuffer,
        fileName,
        contentType: 'video/mp4',
        context: 'copilot',
      })

      videoUrl = `${getBaseUrl()}${fileInfo.path}`
    } catch (error) {
      logger.error(`[${requestId}] Failed to upload video file (fallback):`, error)
      throw new Error(`Failed to store video: ${getErrorMessage(error, 'Unknown error')}`)
    }

    logger.info(`[${requestId}] Video generation completed successfully`)

    return NextResponse.json({
      videoUrl,
      duration: actualDuration || duration,
      width,
      height,
      provider,
      model: model || 'default',
      jobId,
      __falaiCostDollars: falaiCost?.costDollars,
      __falaiBilling: falaiCost,
    })
  } catch (error) {
    logger.error(`[${requestId}] Video proxy error:`, error)
    const errorMessage = getErrorMessage(error, 'Unknown error')
    return NextResponse.json(
      { error: errorMessage },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})

async function generateWithRunway(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  resolution: string,
  visualReference: UserFile | undefined,
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  logger.info(`[${requestId}] Starting Runway Gen-4 generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  // Convert aspect ratio to resolution format for 2024-11-06 API version
  const ratioMap: { [key: string]: string } = {
    '16:9': '1280:720', // Landscape (720p)
    '9:16': '720:1280', // Portrait (720p)
    '1:1': '960:960', // Square
  }
  const runwayRatio = ratioMap[aspectRatio] || '1280:720'

  const createPayload: any = {
    promptText: prompt,
    duration,
    ratio: runwayRatio, // Use resolution-based ratio for 2024-11-06 API
    model: 'gen4_turbo', // Only gen4_turbo supports image-to-video // Use underscore
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
    createPayload.promptImage = `data:${visualReference.type};base64,${refBase64}` // Use promptImage
  }

  const createResponse = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify(createPayload),
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Runway create error response')
    throw new Error(`Runway API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ id: string }>(createResponse, 'Runway create response')
  const taskId = createData.id

  logger.info(`[${requestId}] Runway task created: ${taskId}`)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
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

      const videoResponse = await fetch(videoUrl)
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
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  logger.info(`[${requestId}] Starting Google Veo generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  const modelNameMap: Record<string, string> = {
    'veo-3': 'veo-3.0-generate-001',
    'veo-3-fast': 'veo-3.0-fast-generate-001', // Fixed: was incorrectly mapped to 3.1
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
      aspectRatio: aspectRatio, // Keep as "16:9", don't convert
      resolution: resolution,
      durationSeconds: duration, // Keep as number
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
    }
  )

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Veo create error response')
    throw new Error(`Veo API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ name: string }>(createResponse, 'Veo create response')
  const operationName = createData.name

  logger.info(`[${requestId}] Veo operation created: ${operationName}`)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      {
        headers: {
          'x-goog-api-key': apiKey,
        },
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
  cameraControl: any | undefined,
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  logger.info(`[${requestId}] Starting Luma Dream Machine generation`)

  const dimensions = getVideoDimensions(aspectRatio, resolution)

  const createPayload: any = {
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
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Luma create error response')
    throw new Error(`Luma API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<{ id: string }>(createResponse, 'Luma create response')
  const generationId = createData.id

  logger.info(`[${requestId}] Luma generation created: ${generationId}`)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
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

      const videoResponse = await fetch(videoUrl)
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
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
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

  // Check for error in response
  if (createData.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax API error: ${createData.base_resp?.status_msg || 'Unknown error'}`)
  }

  const taskId = createData.task_id
  if (!taskId) {
    throw new Error('MiniMax response missing task_id')
  }

  logger.info(`[${requestId}] MiniMax task created: ${taskId}`)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(
      `https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
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

      // Download the video using file_id
      const fileResponse = await fetch(
        `https://api.minimax.io/v1/files/retrieve?file_id=${fileId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
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

      // Download the actual video file
      const videoResponse = await fetch(videoUrl)
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

    // Status is still "Processing" or "Queueing", continue polling
    attempts++
  }

  throw new Error('MiniMax generation timed out')
}

type FalAIDurationFormat = 'number' | 'seconds' | 'string'

interface FalAIModelConfig {
  endpoint: string
  durationFormat?: FalAIDurationFormat
  durationOptions?: readonly number[]
  supportsAspectRatio?: boolean
  aspectRatioOptions?: readonly string[]
  supportsResolution?: boolean
  resolutionOptions?: readonly string[]
  supportsPromptOptimizer?: boolean
  supportsGenerateAudio?: boolean
}

interface FalAIRequestBody {
  prompt: string
  duration?: number | string
  aspect_ratio?: string
  resolution?: string
  prompt_optimizer?: boolean
  generate_audio?: boolean
}

const FALAI_MODEL_CONFIGS: Record<string, FalAIModelConfig> = {
  'veo-3.1': {
    endpoint: 'fal-ai/veo3.1',
    durationFormat: 'seconds',
    durationOptions: [4, 6, 8],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p', '1080p', '4k'],
    supportsGenerateAudio: true,
  },
  'veo-3.1-fast': {
    endpoint: 'fal-ai/veo3.1/fast',
    durationFormat: 'seconds',
    durationOptions: [4, 6, 8],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p', '1080p', '4k'],
    supportsGenerateAudio: true,
  },
  'sora-2': {
    endpoint: 'fal-ai/sora-2/text-to-video',
    durationFormat: 'number',
    durationOptions: [4, 8, 12, 16, 20],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p'],
  },
  'sora-2-pro': {
    endpoint: 'fal-ai/sora-2/text-to-video/pro',
    durationFormat: 'number',
    durationOptions: [4, 8, 12, 16, 20],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p', '1080p', 'true_1080p'],
  },
  'seedance-2.0': {
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    durationFormat: 'string',
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['480p', '720p', '1080p'],
    supportsGenerateAudio: true,
  },
  'seedance-2.0-fast': {
    endpoint: 'bytedance/seedance-2.0/fast/text-to-video',
    durationFormat: 'string',
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['480p', '720p'],
    supportsGenerateAudio: true,
  },
  'kling-v3-pro': {
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video',
    durationFormat: 'string',
    durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16', '1:1'],
    supportsGenerateAudio: true,
  },
  'kling-v3-4k': {
    endpoint: 'fal-ai/kling-video/v3/4k/text-to-video',
    durationFormat: 'string',
    durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16', '1:1'],
    supportsGenerateAudio: true,
  },
  'kling-o3-pro': {
    endpoint: 'fal-ai/kling-video/o3/pro/text-to-video',
    durationFormat: 'string',
    durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16', '1:1'],
    supportsGenerateAudio: true,
  },
  'kling-o3-4k': {
    endpoint: 'fal-ai/kling-video/o3/4k/text-to-video',
    durationFormat: 'string',
    durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16', '1:1'],
    supportsGenerateAudio: true,
  },
  'kling-2.5-turbo-pro': {
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
  },
  'kling-2.1-pro': {
    endpoint: 'fal-ai/kling-video/v2.1/master/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
  },
  'minimax-hailuo-2.3-pro': {
    endpoint: 'fal-ai/minimax/hailuo-2.3/pro/text-to-video',
    supportsPromptOptimizer: true,
  },
  'minimax-hailuo-2.3-standard': {
    endpoint: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
    durationFormat: 'string',
    durationOptions: [6, 10],
    supportsPromptOptimizer: true,
  },
  'minimax-hailuo-02-pro': {
    endpoint: 'fal-ai/minimax/hailuo-02/pro/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsPromptOptimizer: true,
  },
  'minimax-hailuo-02-standard': {
    endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsPromptOptimizer: true,
  },
  'wan-2.2-a14b-turbo': {
    endpoint: 'fal-ai/wan/v2.2-a14b/text-to-video/turbo',
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16', '1:1'],
    supportsResolution: true,
    resolutionOptions: ['480p', '580p', '720p'],
  },
  'wan-2.1': {
    endpoint: 'fal-ai/wan-t2v',
  },
  'ltx-2.3': {
    endpoint: 'fal-ai/ltx-2.3/text-to-video',
    durationFormat: 'number',
    durationOptions: [6, 8, 10],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['1080p', '1440p', '2160p'],
    supportsGenerateAudio: true,
  },
  'ltx-2.3-fast': {
    endpoint: 'fal-ai/ltx-2.3/text-to-video/fast',
    durationFormat: 'number',
    durationOptions: [6, 8, 10, 12, 14, 16, 18, 20],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['1080p', '1440p', '2160p'],
    supportsGenerateAudio: true,
  },
  'ltxv-0.9.8': {
    endpoint: 'fal-ai/ltxv-13b-098-distilled',
  },
}

function formatFalAIDuration(
  format: FalAIDurationFormat | undefined,
  duration: number | undefined
): string | number | undefined {
  if (!format || duration === undefined) return undefined

  if (format === 'number') return duration
  if (format === 'seconds') return `${duration}s`
  return String(duration)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function formatAllowedValues(allowed: readonly (number | string)[]): string {
  return allowed.map(String).join(', ')
}

function getFalAIValidationError(
  model: string,
  duration: number | undefined,
  aspectRatio: string | undefined,
  resolution: string | undefined
): string | undefined {
  const modelConfig = FALAI_MODEL_CONFIGS[model]
  if (!modelConfig) {
    return `Unknown Fal.ai model: ${model}`
  }

  if (
    duration !== undefined &&
    modelConfig.durationOptions &&
    !modelConfig.durationOptions.includes(duration)
  ) {
    return `Invalid duration for Fal.ai model ${model}. Supported durations: ${formatAllowedValues(modelConfig.durationOptions)}`
  }

  if (aspectRatio) {
    if (!modelConfig.supportsAspectRatio) {
      return `Fal.ai model ${model} does not support aspect ratio`
    }

    if (modelConfig.aspectRatioOptions && !modelConfig.aspectRatioOptions.includes(aspectRatio)) {
      return `Invalid aspect ratio for Fal.ai model ${model}. Supported aspect ratios: ${formatAllowedValues(modelConfig.aspectRatioOptions)}`
    }
  }

  if (resolution) {
    if (!modelConfig.supportsResolution) {
      return `Fal.ai model ${model} does not support resolution`
    }

    if (modelConfig.resolutionOptions && !modelConfig.resolutionOptions.includes(resolution)) {
      return `Invalid resolution for Fal.ai model ${model}. Supported resolutions: ${formatAllowedValues(modelConfig.resolutionOptions)}`
    }
  }

  if (
    model === 'ltx-2.3-fast' &&
    duration !== undefined &&
    duration > 10 &&
    resolution &&
    resolution !== '1080p'
  ) {
    return 'Fal.ai model ltx-2.3-fast only supports durations over 10 seconds with 1080p resolution'
  }

  return undefined
}

function getFalAIErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecord(error)) return getStringProperty(error, 'message') || JSON.stringify(error)
  return 'Unknown error'
}

function buildFalAIQueueUrl(
  endpoint: string,
  requestId: string,
  path: 'response' | 'status'
): string {
  return `https://queue.fal.run/${endpoint}/requests/${requestId}/${path}`
}

async function generateWithFalAI(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number | undefined,
  aspectRatio: string | undefined,
  resolution: string | undefined,
  promptOptimizer: boolean | undefined,
  generateAudio: boolean | undefined,
  useHostedCostTracking: boolean,
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{
  buffer: Buffer
  width: number
  height: number
  jobId: string
  duration: number
  falaiCost?: FalAICostMetadata
}> {
  logger.info(`[${requestId}] Starting Fal.ai generation with model: ${model}`)

  const modelConfig = FALAI_MODEL_CONFIGS[model]
  if (!modelConfig) {
    throw new Error(`Unknown Fal.ai model: ${model}`)
  }

  const requestBody: FalAIRequestBody = { prompt }
  const formattedDuration = formatFalAIDuration(modelConfig.durationFormat, duration)

  if (formattedDuration !== undefined) {
    requestBody.duration = formattedDuration
  }

  if (modelConfig.supportsAspectRatio && aspectRatio) {
    requestBody.aspect_ratio = aspectRatio
  }

  if (modelConfig.supportsResolution && resolution) {
    requestBody.resolution = resolution
  }

  if (modelConfig.supportsPromptOptimizer && promptOptimizer !== undefined) {
    requestBody.prompt_optimizer = promptOptimizer
  }

  if (modelConfig.supportsGenerateAudio && generateAudio !== undefined) {
    requestBody.generate_audio = generateAudio
  }

  const createResponse = await fetch(`https://queue.fal.run/${modelConfig.endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Fal.ai create error response')
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<unknown>(createResponse, 'Fal.ai queue response')
  if (!isRecord(createData)) {
    throw new Error('Invalid Fal.ai queue response')
  }

  const requestIdFal = getStringProperty(createData, 'request_id')
  if (!requestIdFal) {
    throw new Error('Fal.ai queue response missing request_id')
  }

  const statusUrl =
    getStringProperty(createData, 'status_url') ||
    buildFalAIQueueUrl(modelConfig.endpoint, requestIdFal, 'status')
  const responseUrl =
    getStringProperty(createData, 'response_url') ||
    buildFalAIQueueUrl(modelConfig.endpoint, requestIdFal, 'response')

  logger.info(`[${requestId}] Fal.ai request created: ${requestIdFal}`)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(statusUrl, {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    })

    if (!statusResponse.ok) {
      await readVideoErrorText(statusResponse, 'Fal.ai status error response')
      throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
    }

    const statusData = await readVideoJson<unknown>(statusResponse, 'Fal.ai status response')
    if (!isRecord(statusData)) {
      throw new Error('Invalid Fal.ai status response')
    }

    if (getStringProperty(statusData, 'status') === 'COMPLETED') {
      const statusError = statusData.error
      if (statusError) {
        throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusError)}`)
      }

      logger.info(`[${requestId}] Fal.ai generation completed after ${attempts * 5}s`)

      const resultResponse = await fetch(
        getStringProperty(statusData, 'response_url') || responseUrl,
        {
          headers: {
            Authorization: `Key ${apiKey}`,
          },
        }
      )

      if (!resultResponse.ok) {
        await readVideoErrorText(resultResponse, 'Fal.ai result error response')
        throw new Error(`Failed to fetch result: ${resultResponse.status}`)
      }

      const resultData = await readVideoJson<unknown>(resultResponse, 'Fal.ai result response')
      if (!isRecord(resultData)) {
        throw new Error('Invalid Fal.ai result response')
      }

      const videoOutput = isRecord(resultData.video) ? resultData.video : undefined
      const fallbackOutput = isRecord(resultData.output) ? resultData.output : undefined
      const videoUrl =
        getStringProperty(videoOutput, 'url') || getStringProperty(fallbackOutput, 'url')
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const videoResponse = await fetch(videoUrl)
      if (!videoResponse.ok) {
        await readVideoErrorText(videoResponse, 'Fal.ai video error response')
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      let width = getNumberProperty(videoOutput, 'width') || 1920
      let height = getNumberProperty(videoOutput, 'height') || 1080

      if (!getNumberProperty(videoOutput, 'width') && aspectRatio?.includes(':')) {
        const dims = getVideoDimensions(aspectRatio, resolution || '1080p')
        width = dims.width
        height = dims.height
      }

      return {
        buffer: await readVideoResponseBuffer(videoResponse, 'Fal.ai video response'),
        width,
        height,
        jobId: requestIdFal,
        duration: getNumberProperty(videoOutput, 'duration') || duration || 5,
        falaiCost: useHostedCostTracking
          ? await getFalAICostMetadata({
              apiKey,
              endpointId: modelConfig.endpoint,
              requestId: requestIdFal,
            })
          : undefined,
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
