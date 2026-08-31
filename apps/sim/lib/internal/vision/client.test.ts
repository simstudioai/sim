/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
  },
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
}))

import { analyzeVision } from '@/lib/internal/vision/client'

describe('Vision client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('preserves the OpenAI request and usage projection with cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        model: 'gpt-5.2',
        choices: [{ message: { content: 'A lighthouse' } }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      })
    )

    await expect(
      analyzeVision(
        {
          apiKey: 'secret',
          imageSource: 'https://images.example.com/a.png',
          model: 'gpt-5.2',
          prompt: 'Describe it',
        },
        controller.signal
      )
    ).resolves.toEqual({
      content: 'A lighthouse',
      model: 'gpt-5.2',
      tokens: 14,
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
      })
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body).toEqual({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe it' },
            {
              type: 'image_url',
              image_url: { url: 'https://images.example.com/a.png' },
            },
          ],
        },
      ],
      max_completion_tokens: 1000,
    })
  })

  it('preserves Anthropic base64 payloads and token totals', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        model: 'claude-3-opus-20240229',
        content: [{ text: 'A lighthouse' }],
        usage: { input_tokens: 8, output_tokens: 3 },
      })
    )

    await expect(
      analyzeVision({
        apiKey: 'secret',
        imageSource: 'data:image/png;base64,YQ==',
        model: 'claude-3-opus-20240229',
        prompt: 'Describe it',
      })
    ).resolves.toEqual({
      content: 'A lighthouse',
      model: 'claude-3-opus-20240229',
      tokens: 11,
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'secret',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      max_tokens: 1024,
      messages: [
        {
          content: [
            { type: 'text', text: 'Describe it' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'YQ==' },
            },
          ],
        },
      ],
    })
  })

  it('pins and bounds Gemini remote image downloads and forwards cancellation', async () => {
    const controller = new AbortController()
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    )
    mocks.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'A lighthouse' }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
    })

    await expect(
      analyzeVision(
        {
          apiKey: 'secret',
          imageSource: 'https://images.example.com/a.png',
          model: 'gemini-2.5-pro',
          prompt: 'Describe it',
          remoteImageResolvedIP: '203.0.113.10',
        },
        controller.signal
      )
    ).resolves.toEqual({ content: 'A lighthouse', model: 'gemini-2.5-pro', tokens: 9 })

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://images.example.com/a.png',
      '203.0.113.10',
      {
        profile: 'contentFetch',
        method: 'GET',
        maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal: controller.signal,
      }
    )
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-pro',
        config: { abortSignal: controller.signal },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Describe it' },
              { inlineData: { mimeType: 'image/png', data: 'AQID' } },
            ],
          },
        ],
      })
    )
  })

  it('preserves provider error status and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { message: 'Invalid API key' } }, { status: 401 })
    )

    await expect(
      analyzeVision({
        apiKey: 'bad',
        imageSource: 'https://images.example.com/a.png',
        model: 'gpt-5.2',
        prompt: 'Describe it',
      })
    ).rejects.toMatchObject({
      status: 401,
      body: { success: false, error: 'Invalid API key' },
    })
  })

  it('rejects oversized Gemini images before buffering', async () => {
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-length': String(MAX_BUFFERED_TRANSFER_BYTES + 1) },
      })
    )

    await expect(
      analyzeVision({
        apiKey: 'secret',
        imageSource: 'https://images.example.com/a.png',
        model: 'gemini-2.5-pro',
        prompt: 'Describe it',
        remoteImageResolvedIP: '203.0.113.10',
      })
    ).rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })
})
