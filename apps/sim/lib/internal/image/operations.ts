import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike, omit } from '@sim/utils/object'
import { getUserFacingErrorMessage } from '@/lib/core/errors/database-query-error'
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
import { buildImageGenerationRequest } from '@/lib/internal/image/request'
import type { ImageGenerationInput, ImageProvider } from '@/lib/internal/image/schema'
import { recordServiceMeteringFailure } from '@/lib/mothership/billing/service-observer'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { resolveStoredFileMetadata } from '@/lib/uploads/utils/stored-file-metadata'

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
  let completedFalCost: FalAICostMetadata | undefined
  logger.info(`[${requestId}] Image generation request started`)

  try {
    context.signal?.throwIfAborted()
    const provider = body.provider as ImageProvider
    const { apiKey, model } = body

    let prepared: ReturnType<typeof buildImageGenerationRequest>
    try {
      prepared = buildImageGenerationRequest(body)
    } catch (error) {
      return Response.json({ error: getErrorMessage(error) }, { status: 400 })
    }

    logger.info(`[${requestId}] Generating image with ${provider}, model: ${model || 'default'}`)

    let imageResult: GeneratedImageResult
    if (provider === 'openai') {
      imageResult = await generateWithOpenAI(apiKey, prepared, requestId, logger, context.signal)
    } else if (provider === 'gemini') {
      imageResult = await generateWithGemini(apiKey, prepared, requestId, logger, context.signal)
    } else if (provider === 'falai') {
      imageResult = await generateWithFalAI(
        apiKey,
        body,
        prepared,
        requestId,
        logger,
        (cost) => {
          completedFalCost = cost
        },
        context.signal
      )
    } else {
      return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
    }

    const storedImage = await storeGeneratedImage(imageResult, context)

    logger.info(`[${requestId}] Image generation completed successfully`, {
      provider,
      model: storedImage.model,
      contentType: storedImage.contentType,
    })

    return Response.json(storedImage)
  } catch (error) {
    if (completedFalCost) {
      logger.warn('Hosted fal image completed but delivery failed', {
        requestId,
        falaiBilling: completedFalCost,
      })
      const { requestId: jobId, endpointId, costDollars } = completedFalCost
      await recordServiceMeteringFailure(
        `Completed fal image ${jobId} (${endpointId}): USD ${costDollars}; delivery failed`
      ).catch((meteringError) => {
        logger.error('Failed to record completed fal image for reconciliation', {
          requestId,
          error: getErrorMessage(meteringError),
        })
      })
    }
    context.signal?.throwIfAborted()
    logger.error(`[${requestId}] Image generation operation error:`, error)
    const errorMessage = getUserFacingErrorMessage(error, 'Unknown error')
    return Response.json(
      { error: errorMessage },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
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
  prepared: ReturnType<typeof buildImageGenerationRequest>,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = prepared.model.id
  const requestBody = prepared.body
  const outputFormat =
    typeof requestBody.output_format === 'string' ? requestBody.output_format : 'png'
  const openaiResponse = await fetch(prepared.endpoint, {
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
  prepared: ReturnType<typeof buildImageGenerationRequest>,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = prepared.model.id
  const requestBody = prepared.body
  const geminiResponse = await fetch(prepared.endpoint, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  })

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
  const app = endpoint.split('/', 2).join('/')
  return `https://queue.fal.run/${app}/requests/${encodeURIComponent(requestId)}${path === 'status' ? '/status' : ''}`
}

function falQueueUrl(url: string): string {
  if (new URL(url).origin !== 'https://queue.fal.run') throw new Error('Invalid Fal.ai queue URL')
  return url
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
  prepared: ReturnType<typeof buildImageGenerationRequest>,
  requestId: string,
  logger: ReturnType<typeof createLogger>,
  onFalCost: (cost: FalAICostMetadata) => void,
  signal?: AbortSignal
): Promise<GeneratedImageResult> {
  const model = prepared.model.id
  const endpoint = prepared.model.endpoint
  if (!endpoint) throw new Error('Missing Fal.ai image endpoint')
  const requestBody = prepared.body
  const createResponse = await fetch(prepared.endpoint, {
    redirect: 'error',
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

  const statusUrl = falQueueUrl(
    getStringProperty(createData, 'status_url') ||
      buildFalAIQueueUrl(endpoint, falRequestId, 'status')
  )
  const responseUrl = falQueueUrl(
    getStringProperty(createData, 'response_url') ||
      buildFalAIQueueUrl(endpoint, falRequestId, 'response')
  )

  logger.info(`[${requestId}] Fal.ai image request created: ${falRequestId}`)

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
      maxRedirects: 0,
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

      const falaiCost = body.useHostedCostTracking
        ? await getFalAICostMetadata({ apiKey, endpointId: endpoint, requestId: falRequestId })
        : undefined
      if (falaiCost) onFalCost(falaiCost)
      signal?.throwIfAborted()

      const resultUrl = falQueueUrl(getStringProperty(statusData, 'response_url') || responseUrl)
      const resultValidation = await validateUrlWithDNS(resultUrl, 'resultUrl', 'contentFetch')
      if (!resultValidation.isValid) {
        throw new Error(resultValidation.error)
      }
      const resultResponse = await secureFetchWithPinnedIP(resultUrl, resultValidation.resolvedIP, {
        profile: 'contentFetch',
        maxRedirects: 0,
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

      const firstImage =
        prepared.model.output === 'image' && isRecordLike(resultData.image)
          ? resultData.image
          : firstRecord(resultData.images)
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
        falaiCost,
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
  const { fileName, mimeType: contentType } = resolveStoredFileMetadata(
    imageResult.fileName || `image-${imageResult.provider}-${Date.now()}.png`,
    imageResult.contentType,
    imageResult.buffer
  )
  const executionContext =
    context.workspaceId && context.workflowId && context.executionId
      ? {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        }
      : null

  // A stored file output is kept as is; a bare URL would be downloaded and stored again.
  const imageFile = executionContext
    ? await uploadExecutionFile(
        executionContext,
        imageResult.buffer,
        fileName,
        contentType,
        context.userId
      )
    : omit(
        await uploadCopilotFile({
          buffer: imageResult.buffer,
          fileName,
          contentType,
          userId: context.userId,
        }),
        ['mimeType']
      )
  context.signal?.throwIfAborted()

  return {
    content: imageFile.url,
    imageUrl: imageFile.url,
    imageFile,
    fileName,
    contentType,
    provider: imageResult.provider,
    model: imageResult.model,
    metadata: {
      provider: imageResult.provider,
      model: imageResult.model,
      description: imageResult.description,
      revisedPrompt: imageResult.revisedPrompt,
      seed: imageResult.seed,
      jobId: imageResult.jobId,
      contentType,
    },
    __falaiCostDollars: imageResult.falaiCost?.costDollars,
    __falaiBilling: imageResult.falaiCost,
  }
}
