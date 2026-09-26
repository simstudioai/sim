import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('@/providers/utils', () => providersUtilsMock)

import { GET } from '@/app/api/providers/ollama/models/route'

const { mockFilterBlacklistedModels, mockIsProviderBlacklisted } = providersUtilsMockFns
const mockIsOllamaUrlConfigured = urlsMockFns.mockIsOllamaUrlConfigured

const request = () => createMockRequest('GET')

describe('ollama models route', () => {
  beforeEach(() => {
    mockIsOllamaUrlConfigured.mockReturnValue(false)
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    vi.stubGlobal('fetch', mockFetch)
    setEnvFlags({ isHosted: false })
  })

  afterAll(resetEnvFlagsMock)

  it('does not probe a loopback Ollama on the hosted platform', async () => {
    setEnvFlags({ isHosted: true })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still honours an explicit OLLAMA_URL on the hosted platform', async () => {
    setEnvFlags({ isHosted: true })
    mockIsOllamaUrlConfigured.mockReturnValue(true)
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: ['llama3'] })
    expect(mockFetch).toHaveBeenCalled()
  })
})
