import { parseRetryAfter } from '@sim/utils/retry'
import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { readBoundedHttpErrorPayload } from '@/lib/knowledge/documents/utils'

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

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

/** Gemini error bodies carry `error.status` and `error.details[].reason` codes. */
const geminiErrorBodySchema = z.object({
  error: z.object({
    status: z.string().max(64).optional(),
    details: z
      .array(z.object({ reason: z.string().max(64).optional() }).passthrough())
      .max(20)
      .optional(),
  }),
})

/** The machine-readable codes of a Gemini error body, such as `INVALID_ARGUMENT API_KEY_INVALID`. */
function geminiErrorCodes(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return 'unparseable error body'
  }
  const result = geminiErrorBodySchema.safeParse(parsed)
  if (!result.success) return 'unrecognized error body'
  const { status, details } = result.data.error
  const codes = [status, ...(details ?? []).map((detail) => detail.reason)].filter(
    (code): code is string => Boolean(code) && /^[A-Z0-9_]+$/.test(code as string)
  )
  return codes.length > 0 ? codes.join(' ') : 'no error code'
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
  image: { bytes: Buffer; mimeType: string }
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
                inlineData: {
                  mimeType: input.image.mimeType,
                  data: input.image.bytes.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: input.responseJsonSchema,
          maxOutputTokens: input.maxOutputTokens,
        },
      }),
      signal: input.signal,
      redirect: 'error',
    }
  )
  if (!response.ok) {
    const payload = await readBoundedHttpErrorPayload(response)
    throw new GeminiImageExtractionError(
      response.status,
      parseRetryAfter(response.headers.get('retry-after')) ?? undefined,
      payload.ok ? geminiErrorCodes(payload.body) : 'no readable error body'
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
