import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFilterBlacklistedModels,
  mockIsProviderBlacklisted,
  mockFetch,
  mockIsOllamaUrlConfigured,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockFetch: vi.fn(),
  mockIsOllamaUrlConfigured: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  filterBlacklistedModels: mockFilterBlacklistedModels,
  isProviderBlacklisted: mockIsProviderBlacklisted,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getOllamaUrl: () => 'http://localhost:11434',
  isOllamaUrlConfigured: mockIsOllamaUrlConfigured,
}))

import { GET } from '@/app/api/providers/ollama/models/route'

const request = () => createMockRequest('GET')

describe('ollama models route', () => {
  beforeEach(() => {
    mockIsOllamaUrlConfigured.mockReturnValue(false)
    mockIsProviderBlacklisted.mockReturnValue(false)
    mockFilterBlacklistedModels.mockImplementation((models: string[]) => models)
    vi.stubGlobal('fetch', mockFetch)
    setEnvFlags({ isHosted: false })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    resetEnvFlagsMock()
  })

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
