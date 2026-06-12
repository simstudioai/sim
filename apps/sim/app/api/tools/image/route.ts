import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type ImageToolBody,
  type imageProviders,
  imageProxyQuerySchema,
  imageToolContract,
} from '@/lib/api/contracts/tools/media/image'
import {
  getValidationErrorMessage,
  parseRequest,
  searchParamsToObject,
  validationErrorResponse,
} from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertKnownSizeWithinLimit,
  consumeOrCancelBody,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'

const logger = createLogger('ImageProxyAPI')
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_JSON_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 256 * 1024

export const dynamic = 'force-dynamic'
/**
 * Mirrors the maximum plan execution timeout (enterprise async, 90 minutes) used by
 * `getMaxExecutionTimeout()` for the provider polling loop below. Next.js requires a
 * static literal for `maxDuration`, so this value must be kept in sync with that source.
 */
export const maxDuration = 5400

type ImageProvider = (typeof imageProviders)[number]

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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Image generation request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      imageToolContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid image generation request:`, error.issues)
          return validationErrorResponse(
            error,
            getValidationErrorMessage(error, 'Invalid request data')
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const provider = body.provider as ImageProvider
    const { apiKey, model, prompt } = body

    if (prompt.length < 3 || prompt.length > 4000) {
      return NextResponse.json(
        { error: 'Prompt must be between 3 and 4000 characters' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Generating image with ${provider}, model: ${model || 'default'}`)

    let imageResult: GeneratedImageResult
    try {
      if (provider === 'openai') {
        imageResult = await generateWithOpenAI(apiKey, body, requestId, logger)
      } else if (provider === 'gemini') {
        imageResult = await generateWithGemini(apiKey, body, requestId, logger)
      } else if (provider === 'falai') {
        imageResult = await generateWithFalAI(apiKey, body, requestId, logger)
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] Image generation failed:`, error)
      const errorMessage = getErrorMessage(error, 'Image generation failed')
      return NextResponse.json(
        { error: errorMessage },
        { status: isPayloadSizeLimitError(error) ? 413 : 500 }
      )
    }

    const storedImage = await storeGeneratedImage(imageResult, body, authResult.userId, requestId)

    logger.info(`[${requestId}] Image generation completed successfully`, {
      provider,
      model: storedImage.model,
      contentType: storedImage.contentType,
    })

    return NextResponse.json(storedImage)
  } catch (error) {
    logger.error(`[${requestId}] Image generation route error:`, error)
    const errorMessage = getErrorMessage(error, 'Unknown error')
    return NextResponse.json(
      { error: errorMessage },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})

/**
 * Proxy for fetching images
 * This allows client-side requests to fetch images from various sources while avoiding CORS issues
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.error(`[${requestId}] Authentication failed for image proxy:`, authResult.error)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const queryResult = imageProxyQuerySchema.safeParse(
    searchParamsToObject(request.nextUrl.searchParams)
  )
  if (!queryResult.success) {
    const error = getValidationErrorMessage(queryResult.error, 'Missing URL parameter')
    logger.error(`[${requestId}] ${error}`)
    return new NextResponse(error, { status: 400 })
  }
  const { url: imageUrl } = queryResult.data

  const urlValidation = await validateUrlWithDNS(imageUrl, 'imageUrl')
  if (!urlValidation.isValid) {
    logger.warn(`[${requestId}] Blocked image proxy request`, {
      url: imageUrl.substring(0, 100),
      error: urlValidation.error,
    })
    return new NextResponse(urlValidation.error || 'Invalid image URL', { status: 403 })
  }

  logger.info(`[${requestId}] Proxying image request for: ${imageUrl}`)

  try {
    const imageResponse = await secureFetchWithPinnedIP(imageUrl, urlValidation.resolvedIP!, {
      method: 'GET',
      maxResponseBytes: MAX_IMAGE_BYTES,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'image/webp,image/avif,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Referer: 'https://sim.ai/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    })

    if (!imageResponse.ok) {
      await consumeOrCancelBody(imageResponse)
      logger.error(`[${requestId}] Image fetch failed:`, {
        status: imageResponse.status,
        statusText: imageResponse.statusText,
      })
      return new NextResponse(`Failed to fetch image: ${imageResponse.statusText}`, {
        status: imageResponse.status,
      })
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'

    const imageBuffer = await readResponseToBufferWithLimit(imageResponse, {
      maxBytes: MAX_IMAGE_BYTES,
      label: 'image proxy response',
    })

    if (imageBuffer.length === 0) {
      logger.error(`[${requestId}] Empty image received`)
      return new NextResponse('Empty image received', { status: 404 })
    }

    return new NextResponse(new Uint8Array(imageBuffer), {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
    })
  } catch (error) {
    const errorMessage = toError(error).message
    logger.error(`[${requestId}] Image proxy error:`, { error: errorMessage })

    return new NextResponse(`Failed to proxy image: ${errorMessage}`, {
      status: isPayloadSizeLimitError(error) ? 413 : 500,
    })
  }
})

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

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value.find(isRecord) : undefined
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

async function bufferFromImageUrl(url: string): Promise<{ buffer: Buffer; contentType: string }> {
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

  const urlValidation = await validateUrlWithDNS(url, 'imageUrl')
  if (!urlValidation.isValid || !urlValidation.resolvedIP) {
    throw new Error(urlValidation.error || 'Generated image URL failed validation')
  }

  const imageResponse = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
    method: 'GET',
    maxResponseBytes: MAX_IMAGE_BYTES,
  })
  if (!imageResponse.ok) {
    await readResponseTextWithLimit(imageResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'generated image error response',
    }).catch(() => '')
    throw new Error(`Failed to download generated image: ${imageResponse.status}`)
  }

  const contentType = imageResponse.headers.get('content-type') || 'image/png'
  const buffer = await readResponseToBufferWithLimit(imageResponse, {
    maxBytes: MAX_IMAGE_BYTES,
    label: 'generated image download',
  })
  return { buffer, contentType }
}

async function generateWithOpenAI(
  apiKey: string,
  body: ImageToolBody,
  requestId: string,
  logger: ReturnType<typeof createLogger>
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
  })

  if (!openaiResponse.ok) {
    const error = await readResponseTextWithLimit(openaiResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OpenAI image error response',
    })
    throw new Error(`OpenAI API error: ${openaiResponse.status} - ${error}`)
  }

  const data = await readResponseJsonWithLimit(openaiResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'OpenAI image response',
  })
  if (!isRecord(data)) {
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
    const downloaded = await bufferFromImageUrl(imageUrl)
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
  body: ImageToolBody,
  requestId: string,
  logger: ReturnType<typeof createLogger>
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
    }
  )

  if (!geminiResponse.ok) {
    const error = await readResponseTextWithLimit(geminiResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Gemini image error response',
    })
    throw new Error(`Gemini API error: ${geminiResponse.status} - ${error}`)
  }

  const data = await readResponseJsonWithLimit(geminiResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'Gemini image response',
  })
  if (!isRecord(data)) {
    throw new Error('Invalid Gemini image response')
  }

  const candidate = firstRecord(data.candidates)
  const content = isRecord(candidate?.content) ? candidate.content : undefined
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const textPart = parts.find((part) => isRecord(part) && typeof part.text === 'string')
  const imagePart = parts.find((part) => {
    if (!isRecord(part)) return false
    return isRecord(part.inlineData) || isRecord(part.inline_data)
  })

  if (!isRecord(imagePart)) {
    logger.error(`[${requestId}] Gemini response missing image part`)
    throw new Error('No image data found in Gemini response')
  }

  const inlineData = isRecord(imagePart.inlineData)
    ? imagePart.inlineData
    : isRecord(imagePart.inline_data)
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
    description: isRecord(textPart) ? getStringProperty(textPart, 'text') : undefined,
  }
}

function buildFalAIQueueUrl(endpoint: string, requestId: string, path: 'status' | 'response') {
  return `https://queue.fal.run/${endpoint}/requests/${requestId}/${path}`
}

function getFalAIErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecord(error)) {
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
  body: ImageToolBody,
  requestId: string,
  logger: ReturnType<typeof createLogger>
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
  })

  if (!createResponse.ok) {
    const error = await readResponseTextWithLimit(createResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Fal.ai create error response',
    })
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readResponseJsonWithLimit(createResponse, {
    maxBytes: MAX_IMAGE_JSON_BYTES,
    label: 'Fal.ai create response',
  })
  if (!isRecord(createData)) {
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

  const pollIntervalMs = 3000
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
      await readResponseTextWithLimit(statusResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Fal.ai status error response',
      }).catch(() => '')
      throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
    }

    const statusData = await readResponseJsonWithLimit(statusResponse, {
      maxBytes: MAX_IMAGE_JSON_BYTES,
      label: 'Fal.ai status response',
    })
    if (!isRecord(statusData)) {
      throw new Error('Invalid Fal.ai status response')
    }

    const status = getStringProperty(statusData, 'status')
    if (status === 'COMPLETED') {
      const statusError = statusData.error
      if (statusError) {
        throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusError)}`)
      }

      const resultResponse = await fetch(
        getStringProperty(statusData, 'response_url') || responseUrl,
        {
          headers: {
            Authorization: `Key ${apiKey}`,
          },
        }
      )

      if (!resultResponse.ok) {
        await readResponseTextWithLimit(resultResponse, {
          maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
          label: 'Fal.ai result error response',
        }).catch(() => '')
        throw new Error(`Failed to fetch Fal.ai result: ${resultResponse.status}`)
      }

      const resultData = await readResponseJsonWithLimit(resultResponse, {
        maxBytes: MAX_IMAGE_JSON_BYTES,
        label: 'Fal.ai result response',
      })
      if (!isRecord(resultData)) {
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

      const downloaded = await bufferFromImageUrl(imageUrl)
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
  body: ImageToolBody,
  userId: string,
  requestId: string
): Promise<StoredImageResponse> {
  const timestamp = Date.now()
  const safeFileName = imageResult.fileName || `image-${imageResult.provider}-${timestamp}.png`
  const executionContext =
    body.workspaceId && body.workflowId && body.executionId
      ? {
          workspaceId: body.workspaceId,
          workflowId: body.workflowId,
          executionId: body.executionId,
        }
      : null

  if (executionContext) {
    const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
    const imageFile = await uploadExecutionFile(
      executionContext,
      imageResult.buffer,
      safeFileName,
      imageResult.contentType,
      userId
    )

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

  const { StorageService } = await import('@/lib/uploads')
  const fileInfo = await StorageService.uploadFile({
    file: imageResult.buffer,
    fileName: safeFileName,
    contentType: imageResult.contentType,
    context: 'copilot',
  })
  const imageUrl = `${getBaseUrl()}${fileInfo.path}`
  logger.info(`[${requestId}] Stored generated image fallback`, {
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
