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

/** Gemini answered with an HTTP failure; `status` drives retry and deferral. */
export class GeminiImageExtractionError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    detail: string
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

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
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
      retryAfterMs(response),
      payload.ok ? payload.body.slice(0, 500) : 'no readable error body'
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
