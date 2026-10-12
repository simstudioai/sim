/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiImageExtractionError,
  requestGeminiImageExtraction,
} from '@/lib/knowledge/documents/image-extraction-gemini'

const fetchMock = vi.fn<typeof fetch>()

function call() {
  return requestGeminiImageExtraction({
    model: 'gemini-3.8-flash',
    apiKey: 'key',
    systemPrompt: 'Extract.',
    userText: 'Attachment title: Calendar',
    image: { bytes: Buffer.from('png bytes'), mimeType: 'image/png' },
    responseJsonSchema: { type: 'object' },
    maxOutputTokens: 32_768,
    signal: new AbortController().signal,
  })
}

describe('requestGeminiImageExtraction', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the image inline with a JSON-schema response and reads text and billed tokens', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking', thought: true },
                { text: '{"kind":' },
                { text: '"photo"}' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: 200,
          thoughtsTokenCount: 100,
        },
      })
    )

    expect(await call()).toEqual({
      text: '{"kind":"photo"}',
      finishReason: 'STOP',
      inputTokens: 1200,
      outputTokens: 300,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    )
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'key' })
    const body = JSON.parse(String(init?.body))
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/png',
      data: Buffer.from('png bytes').toString('base64'),
    })
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      maxOutputTokens: 32_768,
    })
  })

  it('surfaces an HTTP failure with its status and retry hint', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"Resource exhausted"}}', {
        status: 429,
        headers: { 'retry-after': '7' },
      })
    )
    const failure = call()
    await expect(failure).rejects.toBeInstanceOf(GeminiImageExtractionError)
    await expect(failure).rejects.toMatchObject({ status: 429, retryAfterMs: 7000 })
  })
})
