import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import type { VideoRequestBody } from '@/tools/video/types'

const logger = createLogger('VideoProxyAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10 minutes for video generation

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] Video generation request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: VideoRequestBody = await request.json()
    const { provider, apiKey, model, prompt, duration, aspectRatio, resolution } = body

    if (!provider || !apiKey || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, apiKey, and prompt' },
        { status: 400 }
      )
    }

    const validProviders = ['runway', 'veo', 'luma', 'minimax', 'falai']
    if (!validProviders.includes(provider)) {
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

    // Validate aspect ratio (Veo only supports 16:9 and 9:16)
    const validAspectRatios = provider === 'veo' ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1']
    if (aspectRatio && !validAspectRatios.includes(aspectRatio)) {
      return NextResponse.json(
        { error: `Aspect ratio must be ${validAspectRatios.join(', ')}` },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Generating video with ${provider}, model: ${model || 'default'}`)

    let videoUrl: string
    let videoBuffer: Buffer
    let width: number | undefined
    let height: number | undefined
    let jobId: string | undefined
    let actualDuration: number | undefined

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
          model || 'hailuo-02',
          prompt,
          duration || 6,
          body.promptOptimizer !== false, // Default true
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
        const result = await generateWithFalAI(
          apiKey,
          model,
          prompt,
          duration,
          aspectRatio,
          resolution,
          body.promptOptimizer,
          requestId,
          logger
        )
        videoBuffer = result.buffer
        width = result.width
        height = result.height
        jobId = result.jobId
        actualDuration = result.duration
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] Video generation failed:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Video generation failed'
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    const hasExecutionContext = body.workspaceId && body.workflowId && body.executionId

    logger.info(`[${requestId}] Storing video file, size: ${videoBuffer.length} bytes`)

    if (hasExecutionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const timestamp = Date.now()
      const fileName = `video-${provider}-${timestamp}.mp4`

      let videoFile
      try {
        videoFile = await uploadExecutionFile(
          {
            workspaceId: body.workspaceId!,
            workflowId: body.workflowId!,
            executionId: body.executionId!,
          },
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
        throw new Error(
          `Failed to store video: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
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
      throw new Error(
        `Failed to store video: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
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
    })
  } catch (error) {
    logger.error(`[${requestId}] Video proxy error:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

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
    const refBuffer = await downloadFileFromStorage(visualReference, requestId, logger)
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
    const error = await createResponse.text()
    throw new Error(`Runway API error: ${createResponse.status} - ${error}`)
  }

  const createData = await createResponse.json()
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
      throw new Error(`Runway status check failed: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json()

    if (statusData.status === 'SUCCEEDED') {
      logger.info(`[${requestId}] Runway generation completed after ${attempts * 5}s`)

      const videoResponse = await fetch(statusData.output[0])
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      const arrayBuffer = await videoResponse.arrayBuffer()
      return {
        buffer: Buffer.from(arrayBuffer),
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
    const error = await createResponse.text()
    throw new Error(`Veo API error: ${createResponse.status} - ${error}`)
  }

  const createData = await createResponse.json()
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
      throw new Error(`Veo status check failed: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json()

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
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      const arrayBuffer = await videoResponse.arrayBuffer()
      return {
        buffer: Buffer.from(arrayBuffer),
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
    const error = await createResponse.text()
    throw new Error(`Luma API error: ${createResponse.status} - ${error}`)
  }

  const createData = await createResponse.json()
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
      throw new Error(`Luma status check failed: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json()

    if (statusData.state === 'completed') {
      logger.info(`[${requestId}] Luma generation completed after ${attempts * 5}s`)

      const videoUrl = statusData.assets?.video
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const videoResponse = await fetch(videoUrl)
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      const arrayBuffer = await videoResponse.arrayBuffer()
      return {
        buffer: Buffer.from(arrayBuffer),
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
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  logger.info(`[${requestId}] Starting MiniMax Hailuo generation via MiniMax Platform API`)
  logger.info(
    `[${requestId}] Request params - model: ${model}, duration: ${duration}, promptOptimizer: ${promptOptimizer}`
  )

  // Determine resolution and dimensions based on duration
  // MiniMax-Hailuo-02 supports 768P (6s) or 1080P (10s)
  const resolution = duration === 10 ? '1080P' : '768P'
  const dimensions = duration === 10 ? { width: 1920, height: 1080 } : { width: 1360, height: 768 }

  logger.info(
    `[${requestId}] Using resolution: ${resolution}, dimensions: ${dimensions.width}x${dimensions.height}`
  )

  // Map our model ID to MiniMax model name
  const minimaxModel = model === 'hailuo-02' ? 'MiniMax-Hailuo-02' : 'MiniMax-Hailuo-2.3'

  // Create video generation request via MiniMax Platform API
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
    const errorText = await createResponse.text()
    if (createResponse.status === 401 || createResponse.status === 1004) {
      throw new Error(
        `MiniMax API authentication failed (${createResponse.status}). Please ensure you're using a valid MiniMax API key from platform.minimax.io. Error: ${errorText}`
      )
    }
    throw new Error(`MiniMax API error: ${createResponse.status} - ${errorText}`)
  }

  const createData = await createResponse.json()

  // Check for error in response
  if (createData.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax API error: ${createData.base_resp?.status_msg || 'Unknown error'}`)
  }

  const taskId = createData.task_id

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
      throw new Error(`MiniMax status check failed: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json()

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
        throw new Error(`Failed to download video: ${fileResponse.status}`)
      }

      const fileData = await fileResponse.json()
      const videoUrl = fileData.file?.download_url

      if (!videoUrl) {
        throw new Error('No download URL in file response')
      }

      // Download the actual video file
      const videoResponse = await fetch(videoUrl)
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from URL: ${videoResponse.status}`)
      }

      const arrayBuffer = await videoResponse.arrayBuffer()
      return {
        buffer: Buffer.from(arrayBuffer),
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

// Helper function to strip subpaths from Fal.ai model IDs for status/result endpoints
function getBaseModelId(fullModelId: string): string {
  const parts = fullModelId.split('/')
  // Keep only the first two parts (e.g., "fal-ai/sora-2" from "fal-ai/sora-2/text-to-video")
  if (parts.length > 2) {
    return parts.slice(0, 2).join('/')
  }
  return fullModelId
}

// Helper function to format duration based on model requirements
function formatDuration(model: string, duration: number | undefined): string | number | undefined {
  if (duration === undefined) return undefined

  // Veo 3.1 requires duration with "s" suffix (e.g., "8s")
  if (model === 'veo-3.1') {
    return `${duration}s`
  }

  // Sora 2 requires numeric duration
  if (model === 'sora-2') {
    return duration
  }

  // Other models use string format
  return String(duration)
}

async function generateWithFalAI(
  apiKey: string,
  model: string,
  prompt: string,
  duration: number | undefined,
  aspectRatio: string | undefined,
  resolution: string | undefined,
  promptOptimizer: boolean | undefined,
  requestId: string,
  logger: ReturnType<typeof createLogger>
): Promise<{ buffer: Buffer; width: number; height: number; jobId: string; duration: number }> {
  logger.info(`[${requestId}] Starting Fal.ai generation with model: ${model}`)

  // Map our model IDs to Fal.ai model paths
  const modelMap: { [key: string]: string } = {
    'veo-3.1': 'fal-ai/veo3.1',
    'sora-2': 'fal-ai/sora-2/text-to-video',
    'kling-2.5-turbo-pro': 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    'kling-2.1-pro': 'fal-ai/kling-video/v2.1/master/text-to-video',
    'minimax-hailuo-2.3-pro': 'fal-ai/minimax/hailuo-02/pro/text-to-video',
    'minimax-hailuo-2.3-standard': 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    'wan-2.1': 'fal-ai/wan-t2v',
    'ltxv-0.9.8': 'fal-ai/ltxv-13b-098-distilled',
  }

  const falModelId = modelMap[model]
  if (!falModelId) {
    throw new Error(`Unknown Fal.ai model: ${model}`)
  }

  // Build request body based on model requirements
  const requestBody: any = { prompt }

  // Models that support duration and aspect_ratio parameters
  const supportsStandardParams = [
    'kling-2.5-turbo-pro',
    'kling-2.1-pro',
    'minimax-hailuo-2.3-pro',
    'minimax-hailuo-2.3-standard',
  ]

  // Models that only need prompt (minimal params)
  const minimalParamModels = ['ltxv-0.9.8', 'wan-2.1', 'veo-3.1', 'sora-2']

  if (supportsStandardParams.includes(model)) {
    // Kling and MiniMax models support duration and aspect_ratio
    const formattedDuration = formatDuration(model, duration)
    if (formattedDuration !== undefined) {
      requestBody.duration = formattedDuration
    }

    if (aspectRatio) {
      requestBody.aspect_ratio = aspectRatio
    }

    if (resolution) {
      requestBody.resolution = resolution
    }
  }

  // MiniMax models support prompt optimizer
  if (model.startsWith('minimax-hailuo') && promptOptimizer !== undefined) {
    requestBody.prompt_optimizer = promptOptimizer
  }

  const createResponse = await fetch(`https://queue.fal.run/${falModelId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!createResponse.ok) {
    const error = await createResponse.text()
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await createResponse.json()
  const requestIdFal = createData.request_id

  logger.info(`[${requestId}] Fal.ai request created: ${requestIdFal}`)

  // Get base model ID (without subpath) for status and result endpoints
  const baseModelId = getBaseModelId(falModelId)

  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollIntervalMs)

    const statusResponse = await fetch(
      `https://queue.fal.run/${baseModelId}/requests/${requestIdFal}/status`,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      }
    )

    if (!statusResponse.ok) {
      throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
    }

    const statusData = await statusResponse.json()

    if (statusData.status === 'COMPLETED') {
      logger.info(`[${requestId}] Fal.ai generation completed after ${attempts * 5}s`)

      const resultResponse = await fetch(
        `https://queue.fal.run/${baseModelId}/requests/${requestIdFal}`,
        {
          headers: {
            Authorization: `Key ${apiKey}`,
          },
        }
      )

      if (!resultResponse.ok) {
        throw new Error(`Failed to fetch result: ${resultResponse.status}`)
      }

      const resultData = await resultResponse.json()

      const videoUrl = resultData.video?.url || resultData.output?.url
      if (!videoUrl) {
        throw new Error('No video URL in response')
      }

      const videoResponse = await fetch(videoUrl)
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`)
      }

      const arrayBuffer = await videoResponse.arrayBuffer()

      // Try to get dimensions from response, or calculate from aspect ratio
      let width = resultData.video?.width || 1920
      let height = resultData.video?.height || 1080

      if (!resultData.video?.width && aspectRatio) {
        const dims = getVideoDimensions(aspectRatio, resolution || '1080p')
        width = dims.width
        height = dims.height
      }

      return {
        buffer: Buffer.from(arrayBuffer),
        width,
        height,
        jobId: requestIdFal,
        duration: duration || 5,
      }
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`Fal.ai generation failed: ${statusData.error || 'Unknown error'}`)
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
  if (resolution === '4k') {
    height = 2160
  } else {
    height = Number.parseInt(resolution.replace('p', ''))
  }

  const [ratioW, ratioH] = aspectRatio.split(':').map(Number)
  const width = Math.round((height * ratioW) / ratioH)

  return { width, height }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
