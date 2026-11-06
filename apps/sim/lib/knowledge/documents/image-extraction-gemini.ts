import { createLogger } from '@sim/logger'
import { parseRetryAfter } from '@sim/utils/retry'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/processing-error'
import { readBoundedHttpErrorPayload } from '@/lib/knowledge/documents/utils'
import { getProviderModels } from '@/providers/models'
import { isGemini3OrLaterModel } from '@/providers/utils'

const logger = createLogger('GeminiImageExtraction')

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** The provider identity image extraction is admitted and billed under. */
export const GEMINI_IMAGE_PROVIDER_ID = 'google'

export const DEFAULT_IMAGE_EXTRACTION_MODEL = 'gemini-3.8-flash'

/**
 * Transcription needs little reasoning, and Gemini bills thinking as output that
 * also spends the output budget. Gemini 3 and later models accept `LOW`.
 */
const THINKING_LEVEL = 'LOW'

/**
 * Failures worth an immediate retry inside one extraction: transient server
 * errors, which Gemini does not bill. Throttling (429) and overload (503) defer
 * the pass through provider admission instead.
 */
const TRANSIENT_STATUSES = new Set([500, 502, 504])

/** 400 reasons caused by the deployment's key or region, never by the image. */
const CONFIGURATION_REASONS = ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'FAILED_PRECONDITION']

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
}

/**
 * Gemini answered with an HTTP failure; `status` drives retry and deferral. `detail`
 * holds only Gemini's error status and reason codes, never the response body, which
 * may echo request content.
 */
export class GeminiImageExtractionError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    readonly detail: string
  ) {
    super(`Gemini image extraction failed (${status}): ${detail}`)
    this.name = 'GeminiImageExtractionError'
  }

  /** Whether the same request may succeed on an immediate retry. */
  get transient(): boolean {
    return TRANSIENT_STATUSES.has(this.status)
  }
}

/**
 * The model from `KB_IMAGE_EXTRACTION_MODEL`, or the default when it is unset or
 * not a Gemini 3 or later model in the catalog: the request uses modern Gemini
 * JSON-schema output and thinking level, and only catalog models carry the pricing that
 * bills each image. Never throws: a bad value must not stop indexing.
 */
export function resolveImageExtractionModel(): string {
  const configured = env.KB_IMAGE_EXTRACTION_MODEL?.trim()
  if (!configured) return DEFAULT_IMAGE_EXTRACTION_MODEL
  const catalogModel = getProviderModels('google').find(
    (id) => id.toLowerCase() === configured.toLowerCase() && isGemini3OrLaterModel(id)
  )
  if (catalogModel) return catalogModel
  logger.warn(
    `KB_IMAGE_EXTRACTION_MODEL="${configured}" is not a supported Gemini 3 or later model, falling back to ${DEFAULT_IMAGE_EXTRACTION_MODEL}`
  )
  return DEFAULT_IMAGE_EXTRACTION_MODEL
}

/**
 * The workspace's Gemini key, then the deployment's, exactly as knowledge
 * embeddings resolve; `null` when neither exists.
 */
export async function resolveGeminiImageKey(
  workspaceId: string | null | undefined
): Promise<{ apiKey: string; isBYOK: boolean } | null> {
  try {
    return await resolveProviderKey('gemini', workspaceId)
  } catch (error) {
    if (error instanceof EmbeddingConfigurationError) return null
    throw error
  }
}

/**
 * Maps a Gemini failure onto processing outcomes: throttling and overload defer
 * the pass, a rejected key, model or region fails the document as unavailable,
 * a rejected image fails it as invalid, anything else is returned unchanged.
 */
export function classifyGeminiImageError(error: GeminiImageExtractionError, model: string): Error {
  if (error.status === 429 || error.status === 503) {
    return new ProviderCapacityDeferredError('rate_limit', {
      providerId: GEMINI_IMAGE_PROVIDER_ID,
      retryAfterMs: error.retryAfterMs,
      cause: error,
    })
  }
  if (
    error.status === 401 ||
    error.status === 403 ||
    (error.status === 400 && CONFIGURATION_REASONS.some((reason) => error.detail.includes(reason)))
  ) {
    return new PermanentDocumentProcessingError(
      'image_extraction_unavailable',
      `Gemini rejected the API key used for ${model}. Check the workspace or deployment Gemini key, then retry.`,
      error
    )
  }
  if (error.status === 404) {
    return new PermanentDocumentProcessingError(
      'image_extraction_unavailable',
      `Gemini does not serve the model ${model}. Set KB_IMAGE_EXTRACTION_MODEL to an available Gemini model, then retry.`,
      error
    )
  }
  if (error.status === 400) {
    return new PermanentDocumentProcessingError(
      'invalid_file',
      'Gemini could not read this image. Replace the attachment with a valid PNG, JPEG, WebP or GIF image, then retry.',
      error
    )
  }
  return error
}

export interface GeminiImageExtractionResponse {
  /** The model's text, expected to be one JSON object; empty when it returned none. */
  text: string
  /** Why generation stopped (`STOP`, `MAX_TOKENS`, `SAFETY`, ...), when reported. */
  finishReason?: string
  inputTokens: number
  /** Billed output, which for Gemini includes thinking tokens. */
  outputTokens: number
}

/**
 * Gemini error bodies carry `error.status`, `error.details[].reason` codes, and a
 * `RetryInfo` detail whose `retryDelay` (such as `"13s"`) says when to retry.
 */
const geminiErrorBodySchema = z.object({
  error: z.object({
    status: z.string().max(64).optional(),
    details: z
      .array(
        z
          .object({
            reason: z.string().max(64).optional(),
            retryDelay: z.string().max(32).optional(),
          })
          .passthrough()
      )
      .max(20)
      .optional(),
  }),
})

/**
 * The machine-readable codes of a Gemini error body, such as
 * `INVALID_ARGUMENT API_KEY_INVALID`, and its retry delay when it gives one.
 */
function readGeminiError(body: string): { detail: string; retryAfterMs?: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { detail: 'unparseable error body' }
  }
  const result = geminiErrorBodySchema.safeParse(parsed)
  if (!result.success) return { detail: 'unrecognized error body' }
  const details = result.data.error.details ?? []
  const codes = [result.data.error.status, ...details.map((detail) => detail.reason)].filter(
    (code): code is string => typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
  )
  const retryDelay = details
    .map((detail) => detail.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/)?.[1])
    .find((seconds) => seconds !== undefined)
  return {
    detail: codes.length > 0 ? codes.join(' ') : 'no error code',
    ...(retryDelay ? { retryAfterMs: Math.ceil(Number(retryDelay) * 1000) } : {}),
  }
}

/**
 * One Gemini `generateContent` call with the image inline and a JSON-schema
 * response. A dedicated transport, as the embedding adapters are: knowledge
 * processing never goes through the workflow provider layer, which carries
 * tool execution and the whole tool registry with it.
 */
export async function requestGeminiImageExtraction(input: {
  model: string
  apiKey: string
  systemPrompt: string
  userText: string
  /** Base64-encoded once by the caller, so a retried attempt does not encode it again. */
  image: { data: string; mimeType: string }
  responseJsonSchema: Record<string, unknown>
  maxOutputTokens: number
  signal: AbortSignal
}): Promise<GeminiImageExtractionResponse> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: input.userText },
              {
                inlineData: { mimeType: input.image.mimeType, data: input.image.data },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: input.responseJsonSchema,
          maxOutputTokens: input.maxOutputTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
        },
      }),
      signal: input.signal,
      redirect: 'error',
    }
  )
  if (!response.ok) {
    const payload = await readBoundedHttpErrorPayload(response)
    const error = payload.ok
      ? readGeminiError(payload.body)
      : { detail: 'no readable error body', retryAfterMs: undefined }
    throw new GeminiImageExtractionError(
      response.status,
      parseRetryAfter(response.headers.get('retry-after')) ?? error.retryAfterMs,
      error.detail
    )
  }
  const json = await readResponseJsonWithLimit<GeminiGenerateContentResponse>(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Gemini image extraction response',
  })
  const [candidate] = json.candidates ?? []
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  const usage = json.usageMetadata ?? {}
  return {
    text,
    finishReason: candidate?.finishReason ?? json.promptFeedback?.blockReason,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  }
}
