/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockFilterBlacklistedModels, mockIsProviderBlacklisted } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  filterBlacklistedModels: mockFilterBlacklistedModels,
  isProviderBlacklisted: mockIsProviderBlacklisted,
}))

import { GET } from '@/app/api/providers/openrouter/embeddings/models/route'

const request = () => createMockRequest('GET')

describe('GET /api/providers/openrouter/embeddings/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('returns every unique embedding model with the OpenRouter prefix', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: [
          { id: 'qwen/qwen3-embedding-8b', context_length: 32768 },
          { id: 'openai/text-embedding-3-small', context_length: 8192 },
          { id: 'qwen/qwen3-embedding-8b', context_length: 32768 },
        ],
      }),
    })

    const response = await GET(request(), undefined as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      models: ['openrouter/qwen/qwen3-embedding-8b', 'openrouter/openai/text-embedding-3-small'],
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings/models',
      expect.objectContaining({ next: { revalidate: 300 } })
    )
  })

  it('does not fetch when OpenRouter is blacklisted', async () => {
    mockIsProviderBlacklisted.mockReturnValue(true)

    const response = await GET(request(), undefined as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails fast when OpenRouter rejects the model-list request', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    })

    const response = await GET(request(), undefined as never)

    expect(response.status).toBe(500)
    expect(mockFilterBlacklistedModels).not.toHaveBeenCalled()
  })
})
