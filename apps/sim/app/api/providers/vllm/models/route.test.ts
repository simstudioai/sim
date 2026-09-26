import { createMockRequest, resetEnvMock, setEnv } from '@sim/testing'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('@/providers/utils', () => providersUtilsMock)

import { GET } from '@/app/api/providers/vllm/models/route'

const { mockFilterBlacklistedModels, mockIsProviderBlacklisted } = providersUtilsMockFns

const request = () => createMockRequest('GET')

describe('vLLM models route', () => {
  beforeEach(() => {
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'local-model' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    setEnv({ VLLM_BASE_URL: 'http://localhost:8000', VLLM_API_KEY: undefined })
  })

  afterAll(resetEnvMock)

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
