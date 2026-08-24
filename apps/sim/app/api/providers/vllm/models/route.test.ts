/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockFilterBlacklistedModels, mockIsProviderBlacklisted } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockFilterBlacklistedModels: vi.fn((models: string[]) => models),
  mockIsProviderBlacklisted: vi.fn(() => false),
}))

vi.mock('@/providers/utils', () => ({
  filterBlacklistedModels: mockFilterBlacklistedModels,
  isProviderBlacklisted: mockIsProviderBlacklisted,
}))

import { GET } from '@/app/api/providers/vllm/models/route'

const request = () => createMockRequest('GET')

describe('vLLM models route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'local-model' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    setEnv({ VLLM_BASE_URL: 'http://localhost:8000', VLLM_API_KEY: undefined })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    resetEnvMock()
  })

  it('discovers and prefixes models from a server-root URL', async () => {
    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: ['vllm/local-model'] })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/models',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    )
  })

  it('uses an existing /v1 prefix once and forwards bearer authentication', async () => {
    setEnv({ VLLM_BASE_URL: 'http://localhost:1234/v1', VLLM_API_KEY: 'lm-token' })

    await GET(request())

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer lm-token',
          'Content-Type': 'application/json',
        },
      })
    )
  })

  it('returns an empty model list when the configured base URL is unsupported', async () => {
    setEnv({ VLLM_BASE_URL: 'http://localhost:1234?token=value' })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
