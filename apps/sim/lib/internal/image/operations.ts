import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_REMOTE_IMAGE_BYTES } from '@/lib/internal/image/fetch'
import type { ImageGenerationInput, ImageProvider } from '@/lib/internal/image/schema'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'

const logger = createLogger('ImageOperations')
const MAX_IMAGE_BYTES = MAX_REMOTE_IMAGE_BYTES
const MAX_IMAGE_JSON_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 256 * 1024

interface GeneratedImageResult {
  buffer: Buffer
  contentType: string
  fileName: string
  provider: ImageProvider
  model: string
  sourceUrl?: string
  description?: string
  revisedPrompt?: string
  seed?: number
  jobId?: string
  falaiCost?: FalAICostMetadata
}

interface StoredImageResponse {
  content: string
  imageUrl: string
  imageFile?: unknown
  fileName: string
  contentType: string
  provider: ImageProvider
  model: string
  metadata: {
    provider: ImageProvider
    model: string
    description?: string
    revisedPrompt?: string
    seed?: number
    jobId?: string
    contentType: string
  }
  __falaiCostDollars?: number
  __falaiBilling?: FalAICostMetadata
}

export interface ImageOperationContext {
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  requestId: string
  signal?: AbortSignal
}

export async function executeImageGeneration(
  body: ImageGenerationInput,
  context: ImageOperationContext
): Promise<Response> {
  const { requestId } = context
  logger.info(`[${requestId}] Image generation request started`)

  try {
    context.signal?.throwIfAborted()
    const provider = body.provider as ImageProvider
    const { apiKey, model, prompt } = body

    if (prompt.length < 3 || prompt.length > 4000) {
      return Response.json(
        { error: 'Prompt must be between 3 and 4000 characters' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Generating image with ${provider}, model: ${model || 'default'}`)

    let imageResult: GeneratedImageResult
    try {
      if (provider === 'openai') {
        imageResult = await generateWithOpenAI(apiKey, body, requestId, logger, context.signal)
      } else if (provider === 'gemini') {
        imageResult = await generateWithGemini(apiKey, body, requestId, logger, context.signal)
      } else if (provider === 'falai') {
        imageResult = await generateWithFalAI(apiKey, body, requestId, logger, context.signal)
      } else {
        return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      logger.error(`[${requestId}] Image generation failed:`, error)
      const errorMessage = getErrorMessage(error, 'Image generation failed')
      return Response.json(
        { error: errorMessage },
        { status: isPayloadSizeLimitError(error) ? 413 : 500 }
      )
    }

    const storedImage = await storeGeneratedImage(imageResult, context)

    logger.info(`[${requestId}] Image generation completed successfully`, {
      provider,
      model: storedImage.model,
      contentType: storedImage.contentType,
    })

    return Response.json(storedImage)
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error(`[${requestId}] Image generation operation error:`, error)
    const errorMessage = getErrorMessage(error, 'Unknown error')
    return Response.json(
      { error: errorMessage },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}

const OPENAI_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
] as const
const OPENAI_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const
const OPENAI_IMAGE_2_SIZES = [...OPENAI_IMAGE_SIZES, '2560x1440', '3840x2160'] as const
const OPENAI_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const
const OPENAI_IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const
const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const
const OPENAI_MODERATION_LEVELS = ['auto', 'low'] as const

const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
] as const
const GEMINI_BASE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const
const GEMINI_EXTREME_ASPECT_RATIOS = ['1:4', '1:8', '4:1', '8:1'] as const
const GEMINI_IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
const GEMINI_PRO_IMAGE_SIZES = ['1K', '2K', '4K'] as const

interface FalAIImageModelConfig {
  endpoint: string
  defaultSize?: string
  sizeOptions?: readonly string[]
  defaultAspectRatio?: string
  aspectRatios?: readonly string[]
  defaultResolution?: string
  resolutionOptions?: readonly string[]
  defaultOutputFormat?: string
  outputFormats?: readonly string[]
  defaultQuality?: string
  qualityOptions?: readonly string[]
  defaultBackground?: string
  backgroundOptions?: readonly string[]
  defaultSafetyTolerance?: string
  safetyToleranceOptions?: readonly string[]
  maxNumImages?: number
  supportsSeed?: boolean
  supportsEnableSafetyChecker?: boolean
  supportsEnableWebSearch?: boolean
  supportsThinkingLevel?: boolean
}

const FALAI_NANO_BANANA_ASPECT_RATIOS = [
  'auto',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
] as const
const FALAI_EXTREME_ASPECT_RATIOS = ['4:1', '1:4', '8:1', '1:8'] as const
const FALAI_STANDARD_IMAGE_SIZES = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
] as const
const FALAI_SEEDREAM_IMAGE_SIZES = [...FALAI_STANDARD_IMAGE_SIZES, 'auto_2K', 'auto_4K'] as const

const FALAI_IMAGE_MODEL_CONFIGS: Record<string, FalAIImageModelConfig> = {
  'nano-banana-2': {
    endpoint: 'fal-ai/nano-banana-2',
    defaultAspectRatio: 'auto',
    aspectRatios: [...FALAI_NANO_BANANA_ASPECT_RATIOS, ...FALAI_EXTREME_ASPECT_RATIOS],
    defaultResolution: '1K',
    resolutionOptions: ['0.5K', '1K', '2K', '4K'],
    defaultOutputFormat: 'png',
    outputFormats: IMAGE_OUTPUT_FORMATS,
    defaultSafetyTolerance: '4',
    safetyToleranceOptions: ['1', '2', '3', '4', '5', '6'],
    maxNumImages: 4,
    supportsSeed: true,
    supportsEnableWebSearch: true,
    supportsThinkingLevel: true,
  },
  'nano-banana-pro': {
    endpoint: 'fal-ai/nano-banana-pro',
    defaultAspectRatio: '1:1',
    aspectRatios: FALAI_NANO_BANANA_ASPECT_RATIOS,
    defaultResolution: '1K',
    resolutionOptions: ['1K', '2K', '4K'],
    defaultOutputFormat: 'png',
    outputFormats: IMAGE_OUTPUT_FORMATS,
    defaultSafetyTolerance: '4',
    safetyToleranceOptions: ['1', '2', '3', '4', '5', '6'],
    maxNumImages: 4,
    supportsSeed: true,
    supportsEnableWebSearch: true,
  },
  'nano-banana': {
    endpoint: 'fal-ai/nano-banana',
    defaultAspectRatio: '1:1',
    aspectRatios: FALAI_NANO_BANANA_ASPECT_RATIOS.filter((ratio) => ratio !== 'auto'),
    defaultOutputFormat: 'png',
    outputFormats: IMAGE_OUTPUT_FORMATS,
    defaultSafetyTolerance: '4',
    safetyToleranceOptions: ['1', '2', '3', '4', '5', '6'],
    maxNumImages: 4,
    supportsSeed: true,
  },
  'gpt-image-1.5': {
    endpoint: 'fal-ai/gpt-image-1.5',
    defaultSize: '1024x1024',
    sizeOptions: ['1024x1024', '1536x1024', '1024x1536'],
    defaultQuality: 'high',
    qualityOptions: ['low', 'medium', 'high'],
    defaultBackground: 'auto',
    backgroundOptions: OPENAI_IMAGE_BACKGROUNDS,
    defaultOutputFormat: 'png',
    outputFormats: IMAGE_OUTPUT_FORMATS,
    maxNumImages: 4,
  },
  'seedream-v4.5': {
    endpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    defaultSize: 'auto_2K',
    sizeOptions: FALAI_SEEDREAM_IMAGE_SIZES,
    maxNumImages: 6,
    supportsSeed: true,
    supportsEnableSafetyChecker: true,
  },
  'flux-2-pro': {
    endpoint: 'fal-ai/flux-2-pro',
    defaultSize: 'landscape_4_3',
    sizeOptions: FALAI_STANDARD_IMAGE_SIZES,
    defaultOutputFormat: 'jpeg',
    outputFormats: ['jpeg', 'png'],
    defaultSafetyTolerance: '2',
    safetyToleranceOptions: ['1', '2', '3', '4', '5'],
    supportsSeed: true,
    supportsEnableSafetyChecker: true,
  },
  'grok-imagine-image': {
    endpoint: 'xai/grok-imagine-image',
    defaultAspectRatio: '1:1',
    aspectRatios: [
      '2:1',
      '20:9',
      '19.5:9',
      '16:9',
      '4:3',
      '3:2',
      '1:1',
      '2:3',
      '3:4',
      '9:16',
      '9:19.5',
      '9:20',
      '1:2',
    ],
    defaultResolution: '1k',
    resolutionOptions: ['1k', '2k'],
    defaultOutputFormat: 'jpeg',
    outputFormats: IMAGE_OUTPUT_FORMATS,
    maxNumImages: 4,
  },
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

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value.find(isRecordLike) : undefined
}

function pickAllowed(
  value: string | undefined,
  allowed: readonly string[],
  fallback: string
): string {
  return value && allowed.includes(value) ? value : fallback
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function getContentTypeForFormat(format: string | undefined): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  return 'png'
}

async function bufferFromImageUrl(
  url: string,
  signal?: AbortSignal
): Promise<{ buffer: Buffer; contentType: string }> {
  signal?.throwIfAborted()
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(url)
    if (!match) throw new Error('Invalid data URI image response')
    const buffer = Buffer.from(match[2], 'base64')
    assertKnownSizeWithinLimit(buffer.length, MAX_IMAGE_BYTES, 'inline image response')
    return {
      contentType: match[1],
      buffer,
    }
  }

  const urlValidation = await validateUrlWithDNS(url, 'imageUrl', 'contentFetch')
  if (!urlValidation.isValid) {
    throw new Error(urlValidation.error || 'Generated image URL failed validation')
  }

  const imageResponse = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
    profile: 'contentFetch',
    method: 'GET',
    maxResponseBytes: MAX_IMAGE_BYTES,
    signal,
  })
  if (!imageResponse.ok) {
    await readResponseTextWithLimit(imageResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'generated image error response',
      signal,
    }).catch(() => '')
    throw new Error(`Failed to download generated image: ${imageResponse.status}`)
  }

  const contentType = imageResponse.headers.get('content-type') || 'image/png'
  const buffer = await readResponseToBufferWithLimit(imageResponse, {
    maxBytes: MAX_IMAGE_BYTES,
    label: 'generated image download',
    signal,
  })
  return { buffer, contentType }
}

async function generateWithOpenAI(
  apiKey: string,
  body: ImageGenerationInput,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = pickAllowed(body.model, OPENAI_IMAGE_MODELS, 'gpt-image-1.5')
  const size =
    model === 'gpt-image-2'
      ? pickAllowed(body.size, OPENAI_IMAGE_2_SIZES, 'auto')
      : pickAllowed(body.size, OPENAI_IMAGE_SIZES, 'auto')
  const outputFormat = pickAllowed(body.outputFormat, IMAGE_OUTPUT_FORMATS, 'png')
  const requestBody: Record<string, string | number> = {
    model,
    prompt: body.prompt,
    size,
    n: 1,
  }

  if (body.quality) {
    requestBody.quality = pickAllowed(body.quality, OPENAI_IMAGE_QUALITIES, 'auto')
  }
  if (body.background) {
    requestBody.background = pickAllowed(body.background, OPENAI_IMAGE_BACKGROUNDS, 'auto')
  }
  if (body.outputFormat) {
    requestBody.output_format = outputFormat
  }
  if (body.moderation) {
    requestBody.moderation = pickAllowed(body.moderation, OPENAI_MODERATION_LEVELS, 'auto')
  }

  const openaiResponse = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!openaiResponse.ok) {
    const error = await readResponseTextWithLimit(openaiResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OpenAI image error response',
      signal,
    })
    throw new Error(`OpenAI API error: ${openaiResponse.status} - ${error}`)
  }

  const data = await readResponseJsonWithLimit(openaiResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'OpenAI image response',
    signal,
  })
  if (!isRecordLike(data)) {
    throw new Error('Invalid OpenAI image response')
  }

  const firstImage = firstRecord(data.data)
  const base64Image = getStringProperty(firstImage, 'b64_json')
  const imageUrl = getStringProperty(firstImage, 'url')
  const revisedPrompt = getStringProperty(firstImage, 'revised_prompt')
  let buffer: Buffer
  let contentType = getContentTypeForFormat(outputFormat)

  if (base64Image) {
    buffer = Buffer.from(base64Image, 'base64')
    assertKnownSizeWithinLimit(buffer.length, MAX_IMAGE_BYTES, 'OpenAI image response')
  } else if (imageUrl) {
    const downloaded = await bufferFromImageUrl(imageUrl, signal)
    buffer = downloaded.buffer
    contentType = downloaded.contentType
  } else {
    logger.error(`[${requestId}] OpenAI response missing image payload`)
    throw new Error('No image data found in OpenAI response')
  }

  return {
    buffer,
    contentType,
    fileName: `openai-${model}.${extensionFromContentType(contentType)}`,
    provider: 'openai',
    model,
    sourceUrl: imageUrl,
    revisedPrompt,
  }
}

async function generateWithGemini(
  apiKey: string,
  body: ImageGenerationInput,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = pickAllowed(body.model, GEMINI_IMAGE_MODELS, 'gemini-3.1-flash-image-preview')
  const aspectRatios =
    model === 'gemini-3.1-flash-image-preview'
      ? [...GEMINI_BASE_ASPECT_RATIOS, ...GEMINI_EXTREME_ASPECT_RATIOS]
      : GEMINI_BASE_ASPECT_RATIOS
  const imageConfig: Record<string, string> = {}

  if (body.aspectRatio) {
    imageConfig.aspectRatio = pickAllowed(body.aspectRatio, aspectRatios, '1:1')
  }

  if (model === 'gemini-3.1-flash-image-preview' && body.resolution) {
    imageConfig.imageSize = pickAllowed(body.resolution, GEMINI_IMAGE_SIZES, '1K')
  } else if (model === 'gemini-3-pro-image-preview' && body.resolution) {
    imageConfig.imageSize = pickAllowed(body.resolution, GEMINI_PRO_IMAGE_SIZES, '1K')
  }

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        parts: [{ text: body.prompt }],
      },
    ],
  }

  requestBody.generationConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
    ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
  }

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    }
  )

  if (!geminiResponse.ok) {
    const error = await readResponseTextWithLimit(geminiResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Gemini image error response',
      signal,
    })
    throw new Error(`Gemini API error: ${geminiResponse.status} - ${error}`)
  }

  const data = await readResponseJsonWithLimit(geminiResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'Gemini image response',
    signal,
  })
  if (!isRecordLike(data)) {
    throw new Error('Invalid Gemini image response')
  }

  const candidate = firstRecord(data.candidates)
  const content = isRecordLike(candidate?.content) ? candidate.content : undefined
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const textPart = parts.find((part) => isRecordLike(part) && typeof part.text === 'string')
  const imagePart = parts.find((part) => {
    if (!isRecordLike(part)) return false
    return isRecordLike(part.inlineData) || isRecordLike(part.inline_data)
  })

  if (!isRecordLike(imagePart)) {
    logger.error(`[${requestId}] Gemini response missing image part`)
    throw new Error('No image data found in Gemini response')
  }

  const inlineData = isRecordLike(imagePart.inlineData)
    ? imagePart.inlineData
    : isRecordLike(imagePart.inline_data)
      ? imagePart.inline_data
      : undefined
  const base64Image = getStringProperty(inlineData, 'data')
  const contentType =
    getStringProperty(inlineData, 'mimeType') ||
    getStringProperty(inlineData, 'mime_type') ||
    'image/png'

  if (!base64Image) {
    throw new Error('Gemini image response missing inline image data')
  }

  return {
    buffer: (() => {
      const buffer = Buffer.from(base64Image, 'base64')
      assertKnownSizeWithinLimit(buffer.length, MAX_IMAGE_BYTES, 'Gemini image response')
      return buffer
    })(),
    contentType,
    fileName: `gemini-${model}.${extensionFromContentType(contentType)}`,
    provider: 'gemini',
    model,
    description: isRecordLike(textPart) ? getStringProperty(textPart, 'text') : undefined,
  }
}

function buildFalAIQueueUrl(endpoint: string, requestId: string, path: 'status' | 'response') {
  return `https://queue.fal.run/${endpoint}/requests/${requestId}/${path}`
}

function getFalAIErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecordLike(error)) {
    return (
      getStringProperty(error, 'message') ||
      getStringProperty(error, 'detail') ||
      JSON.stringify(error)
    )
  }
  return 'Unknown Fal.ai error'
}

async function generateWithFalAI(
  apiKey: string,
  body: ImageGenerationInput,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = body.model || 'nano-banana-2'
  const modelConfig = FALAI_IMAGE_MODEL_CONFIGS[model]
  if (!modelConfig) {
    throw new Error(`Unknown Fal.ai image model: ${model}`)
  }

  const requestBody: Record<string, string | number | boolean> = {
    prompt: body.prompt,
    sync_mode: false,
  }

  if (modelConfig.maxNumImages) {
    requestBody.num_images = clampInteger(body.numImages, 1, modelConfig.maxNumImages, 1)
  }
  if (modelConfig.supportsSeed && body.seed !== undefined) {
    requestBody.seed = body.seed
  }
  if (modelConfig.sizeOptions && modelConfig.defaultSize) {
    requestBody.image_size = pickAllowed(
      body.size,
      modelConfig.sizeOptions,
      modelConfig.defaultSize
    )
  }
  if (modelConfig.aspectRatios && modelConfig.defaultAspectRatio) {
    requestBody.aspect_ratio = pickAllowed(
      body.aspectRatio,
      modelConfig.aspectRatios,
      modelConfig.defaultAspectRatio
    )
  }
  if (modelConfig.resolutionOptions && modelConfig.defaultResolution) {
    requestBody.resolution = pickAllowed(
      body.resolution,
      modelConfig.resolutionOptions,
      modelConfig.defaultResolution
    )
  }
  if (modelConfig.outputFormats && modelConfig.defaultOutputFormat) {
    requestBody.output_format = pickAllowed(
      body.outputFormat,
      modelConfig.outputFormats,
      modelConfig.defaultOutputFormat
    )
  }
  if (modelConfig.qualityOptions && modelConfig.defaultQuality) {
    requestBody.quality = pickAllowed(
      body.quality,
      modelConfig.qualityOptions,
      modelConfig.defaultQuality
    )
  }
  if (modelConfig.backgroundOptions && modelConfig.defaultBackground) {
    requestBody.background = pickAllowed(
      body.background,
      modelConfig.backgroundOptions,
      modelConfig.defaultBackground
    )
  }
  if (modelConfig.safetyToleranceOptions && modelConfig.defaultSafetyTolerance) {
    requestBody.safety_tolerance = pickAllowed(
      body.safetyTolerance,
      modelConfig.safetyToleranceOptions,
      modelConfig.defaultSafetyTolerance
    )
  }
  if (modelConfig.supportsEnableSafetyChecker && body.enableSafetyChecker !== undefined) {
    requestBody.enable_safety_checker = body.enableSafetyChecker
  }
  if (modelConfig.supportsEnableWebSearch && body.enableWebSearch !== undefined) {
    requestBody.enable_web_search = body.enableWebSearch
  }
  if (modelConfig.supportsThinkingLevel && body.thinkingLevel) {
    requestBody.thinking_level = pickAllowed(body.thinkingLevel, ['minimal', 'high'], 'minimal')
  }

  const createResponse = await fetch(`https://queue.fal.run/${modelConfig.endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!createResponse.ok) {
    const error = await readResponseTextWithLimit(createResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Fal.ai create error response',
      signal,
    })
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readResponseJsonWithLimit(createResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'Fal.ai create response',
    signal,
  })
  if (!isRecordLike(createData)) {
    throw new Error('Invalid Fal.ai queue response')
  }

  const falRequestId = getStringProperty(createData, 'request_id')
  if (!falRequestId) {
    throw new Error('Fal.ai queue response missing request_id')
  }

  const statusUrl =
    getStringProperty(createData, 'status_url') ||
    buildFalAIQueueUrl(modelConfig.endpoint, falRequestId, 'status')
  const responseUrl =
    getStringProperty(createData, 'response_url') ||
    buildFalAIQueueUrl(modelConfig.endpoint, falRequestId, 'response')

  logger.info(`[${requestId}] Fal.ai image request created: ${falRequestId}`)

  // `status_url`/`response_url` are read out of the queue response, so they are
  // content: guard and pin them so a spoofed response cannot point an
  // authenticated poll at an internal address. The status URL is constant across
  // the loop, so it is validated once and the pinned address reused.
  const statusValidation = await validateUrlWithDNS(statusUrl, 'statusUrl', 'contentFetch')
  if (!statusValidation.isValid) {
    throw new Error(statusValidation.error)
  }

  const pollIntervalMs = 3000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)
  let attempts = 0

  while (attempts < maxAttempts) {
    await interruptibleSleep(pollIntervalMs, signal)
    signal?.throwIfAborted()

    const statusResponse = await secureFetchWithPinnedIP(statusUrl, statusValidation.resolvedIP, {
      profile: 'contentFetch',
      headers: {
        Authorization: `Key ${apiKey}`,
      },
      maxResponseBytes: MAX_IMAGE_JSON_BYTES,
      signal,
    })

    if (!statusResponse.ok) {
      await readResponseTextWithLimit(statusResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Fal.ai status error response',
        signal,
      }).catch(() => '')
      throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
    }

    const statusData = await readResponseJsonWithLimit(statusResponse, {
      maxBytes: MAX_IMAGE_JSON_BYTES,
      label: 'Fal.ai status response',
      signal,
    })
    if (!isRecordLike(statusData)) {
      throw new Error('Invalid Fal.ai status response')
    }

    const status = getStringProperty(statusData, 'status')
    if (status === 'COMPLETED') {
      const statusError = statusData.error
      if (statusError) {
        throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusError)}`)
      }

      const resultUrl = getStringProperty(statusData, 'response_url') || responseUrl
      const resultValidation = await validateUrlWithDNS(resultUrl, 'resultUrl', 'contentFetch')
      if (!resultValidation.isValid) {
        throw new Error(resultValidation.error)
      }
      const resultResponse = await secureFetchWithPinnedIP(resultUrl, resultValidation.resolvedIP, {
        profile: 'contentFetch',
        headers: {
          Authorization: `Key ${apiKey}`,
        },
        maxResponseBytes: MAX_IMAGE_JSON_BYTES,
        signal,
      })

      if (!resultResponse.ok) {
        await readResponseTextWithLimit(resultResponse, {
          maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
          label: 'Fal.ai result error response',
          signal,
        }).catch(() => '')
        throw new Error(`Failed to fetch Fal.ai result: ${resultResponse.status}`)
      }

      const resultData = await readResponseJsonWithLimit(resultResponse, {
        maxBytes: MAX_IMAGE_JSON_BYTES,
        label: 'Fal.ai result response',
        signal,
      })
      if (!isRecordLike(resultData)) {
        throw new Error('Invalid Fal.ai result response')
      }

      const firstImage = firstRecord(resultData.images)
      const imageUrl =
        getStringProperty(firstImage, 'url') ||
        getStringProperty(firstImage, 'data') ||
        getStringProperty(firstImage, 'content')
      if (!imageUrl) {
        throw new Error('No image URL in Fal.ai response')
      }

      const downloaded = await bufferFromImageUrl(imageUrl, signal)
      const contentType =
        getStringProperty(firstImage, 'content_type') ||
        getStringProperty(firstImage, 'contentType') ||
        downloaded.contentType
      const fileName =
        getStringProperty(firstImage, 'file_name') ||
        getStringProperty(firstImage, 'fileName') ||
        `falai-${model}.${extensionFromContentType(contentType)}`

      return {
        buffer: downloaded.buffer,
        contentType,
        fileName,
        provider: 'falai',
        model,
        sourceUrl: imageUrl.startsWith('data:') ? undefined : imageUrl,
        description: getStringProperty(resultData, 'description'),
        revisedPrompt: getStringProperty(resultData, 'revised_prompt'),
        seed: getNumberProperty(resultData, 'seed'),
        jobId: falRequestId,
        falaiCost: body.useHostedCostTracking
          ? await getFalAICostMetadata({
              apiKey,
              endpointId: modelConfig.endpoint,
              requestId: falRequestId,
              signal,
            })
          : undefined,
      }
    }

    if (['ERROR', 'FAILED', 'CANCELLED'].includes(status || '')) {
      throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusData.error)}`)
    }

    attempts += 1
  }

  throw new Error('Fal.ai image generation timed out')
}

async function storeGeneratedImage(
  imageResult: GeneratedImageResult,
  context: ImageOperationContext
): Promise<StoredImageResponse> {
  context.signal?.throwIfAborted()
  const timestamp = Date.now()
  const safeFileName = imageResult.fileName || `image-${imageResult.provider}-${timestamp}.png`
  const executionContext =
    context.workspaceId && context.workflowId && context.executionId
      ? {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        }
      : null

  if (executionContext) {
    const imageFile = await uploadExecutionFile(
      executionContext,
      imageResult.buffer,
      safeFileName,
      imageResult.contentType,
      context.userId
    )
    context.signal?.throwIfAborted()

    return {
      content: imageFile.url,
      imageUrl: imageFile.url,
      imageFile,
      fileName: safeFileName,
      contentType: imageResult.contentType,
      provider: imageResult.provider,
      model: imageResult.model,
      metadata: {
        provider: imageResult.provider,
        model: imageResult.model,
        description: imageResult.description,
        revisedPrompt: imageResult.revisedPrompt,
        seed: imageResult.seed,
        jobId: imageResult.jobId,
        contentType: imageResult.contentType,
      },
      __falaiCostDollars: imageResult.falaiCost?.costDollars,
      __falaiBilling: imageResult.falaiCost,
    }
  }

  const fileInfo = await uploadCopilotFile({
    buffer: imageResult.buffer,
    fileName: safeFileName,
    contentType: imageResult.contentType,
    userId: context.userId,
  })
  context.signal?.throwIfAborted()
  const imageUrl = fileInfo.url
  logger.info(`[${context.requestId}] Stored generated image fallback`, {
    fileName: safeFileName,
    size: imageResult.buffer.length,
  })

  return {
    content: imageUrl,
    imageUrl,
    fileName: safeFileName,
    contentType: imageResult.contentType,
    provider: imageResult.provider,
    model: imageResult.model,
    metadata: {
      provider: imageResult.provider,
      model: imageResult.model,
      description: imageResult.description,
      revisedPrompt: imageResult.revisedPrompt,
      seed: imageResult.seed,
      jobId: imageResult.jobId,
      contentType: imageResult.contentType,
    },
    __falaiCostDollars: imageResult.falaiCost?.costDollars,
    __falaiBilling: imageResult.falaiCost,
  }
}
