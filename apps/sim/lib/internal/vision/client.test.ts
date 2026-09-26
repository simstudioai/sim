import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
  },
}))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { analyzeVision } from '@/lib/internal/vision/client'

const { mockSecureFetchWithPinnedIP } = inputValidationMockFns

describe('Vision client', () => {
  it('pins and bounds Gemini remote image downloads and forwards cancellation', async () => {
    const controller = new AbortController()
    mockSecureFetchWithPinnedIP.mockResolvedValue(
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

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
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

  it('rejects oversized Gemini images before buffering', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
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
