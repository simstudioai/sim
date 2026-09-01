import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'
import {
  consumeOrCancelBody,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { VisionOperationError } from '@/lib/internal/vision/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { convertUsageMetadata, extractTextContent } from '@/providers/google/utils'

const logger = createLogger('VisionClient')
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024

export interface VisionClientInput {
  apiKey: string
  imageSource: string
  imageContentType?: string
  model: string
  prompt: string
  remoteImageResolvedIP?: string
  remoteImageProfile?: EgressProfile
}

export interface VisionAnalysisResult {
  content?: string
  model?: string
  tokens?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

function record(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function providerErrorMessage(value: unknown): string {
  const data = record(value)
  const nested = record(data.error)
  return string(nested.message) || string(data.message) || 'Failed to analyze image'
}

async function readProviderJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Vision provider response',
    signal,
  })
}

async function readProviderError(response: Response, signal?: AbortSignal): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_PROVIDER_ERROR_BYTES,
    label: 'Vision provider error response',
    signal,
  }).catch(() => {
    signal?.throwIfAborted()
    return {}
  })
}

function parseDataImage(imageSource: string): { mediaType: string; base64Data: string } {
  const marker = ';base64,'
  const markerIndex = imageSource.indexOf(marker)
  if (!imageSource.startsWith('data:') || markerIndex === -1) {
    throw new VisionOperationError('Invalid base64 image format', 400)
  }
  const rawMimeType = imageSource.slice('data:'.length, markerIndex)
  const mediaType = rawMimeType.split(';')[0] || 'image/jpeg'
  const base64Data = imageSource.slice(markerIndex + marker.length)
  if (!base64Data) throw new VisionOperationError('Invalid base64 image format', 400)
  return { mediaType, base64Data }
}

async function fetchGeminiImage(input: VisionClientInput, signal?: AbortSignal): Promise<string> {
  if (input.imageSource.startsWith('data:')) return input.imageSource
  if (!input.remoteImageResolvedIP) {
    throw new VisionOperationError('Invalid image URL', 400)
  }

  const response = await secureFetchWithPinnedIP(input.imageSource, input.remoteImageResolvedIP, {
    profile: input.remoteImageProfile ?? 'contentFetch',
    method: 'GET',
    maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
    signal,
  })
  if (!response.ok) {
    await consumeOrCancelBody(response)
    throw new VisionOperationError('Failed to fetch image for Gemini', 400)
  }
  const contentType = response.headers.get('content-type') || input.imageContentType || 'image/jpeg'
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    label: 'Gemini source image',
    signal,
  })
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

async function analyzeWithGemini(
  input: VisionClientInput,
  signal?: AbortSignal
): Promise<VisionAnalysisResult> {
  signal?.throwIfAborted()
  const base64Payload = await fetchGeminiImage(input, signal)
  const { mediaType, base64Data } = parseDataImage(base64Payload)
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const response = await ai.models.generateContent({
    model: input.model,
    contents: [
      {
        role: 'user',
        parts: [{ text: input.prompt }, { inlineData: { mimeType: mediaType, data: base64Data } }],
      },
    ],
    config: { abortSignal: signal },
  })
  signal?.throwIfAborted()
  const usage = convertUsageMetadata(response.usageMetadata)
  return {
    content: extractTextContent(response.candidates?.[0]),
    model: input.model,
    tokens: usage.totalTokenCount || undefined,
  }
}

function anthropicRequest(input: VisionClientInput): Record<string, unknown> {
  const source = input.imageSource.startsWith('data:')
    ? (() => {
        const match = input.imageSource.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) throw new VisionOperationError('Invalid base64 image format', 400)
        return { type: 'base64', media_type: match[1], data: match[2] }
      })()
    : { type: 'url', url: input.imageSource }
  return {
    model: input.model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'image', source },
        ],
      },
    ],
  }
}

function openAiRequest(input: VisionClientInput): Record<string, unknown> {
  return {
    model: input.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'image_url', image_url: { url: input.imageSource } },
        ],
      },
    ],
    max_completion_tokens: 1000,
  }
}

async function analyzeWithHttpProvider(
  input: VisionClientInput,
  signal?: AbortSignal
): Promise<VisionAnalysisResult> {
  const isClaude = input.model.startsWith('claude-')
  const apiUrl = isClaude
    ? 'https://api.anthropic.com/v1/messages'
    : 'https://api.openai.com/v1/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isClaude) {
    headers['x-api-key'] = input.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${input.apiKey}`
  }

  signal?.throwIfAborted()
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(isClaude ? anthropicRequest(input) : openAiRequest(input)),
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    const error = await readProviderError(response, signal)
    signal?.throwIfAborted()
    logger.error('Vision provider request failed', {
      model: input.model,
      status: response.status,
      error,
    })
    throw new VisionOperationError(providerErrorMessage(error), response.status)
  }

  const data = record(await readProviderJson(response, signal))
  const usage = record(data.usage)
  const content = Array.isArray(data.content) ? record(data.content[0]) : {}
  const choices = Array.isArray(data.choices) ? record(data.choices[0]) : {}
  const message = record(choices.message)
  const inputTokens = number(usage.input_tokens)
  const outputTokens = number(usage.output_tokens)
  const totalTokens = number(usage.total_tokens)
  return {
    content: string(content.text) || string(message.content),
    model: string(data.model),
    tokens: Array.isArray(data.content) ? (inputTokens || 0) + (outputTokens || 0) : totalTokens,
    usage:
      Object.keys(usage).length > 0
        ? {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens || (inputTokens || 0) + (outputTokens || 0),
          }
        : undefined,
  }
}

export async function analyzeVision(
  input: VisionClientInput,
  signal?: AbortSignal
): Promise<VisionAnalysisResult> {
  return input.model.startsWith('gemini-')
    ? analyzeWithGemini(input, signal)
    : analyzeWithHttpProvider(input, signal)
}
