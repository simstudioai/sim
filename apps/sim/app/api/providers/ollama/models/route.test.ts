/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFilterBlacklistedModels,
  mockIsProviderBlacklisted,
  mockFetch,
  mockIsOllamaUrlConfigured,
  ollamaLogger,
} = vi.hoisted(() => ({
  mockFilterBlacklistedModels: vi.fn(),
  mockIsProviderBlacklisted: vi.fn(),
  mockFetch: vi.fn(),
  mockIsOllamaUrlConfigured: vi.fn(),
  ollamaLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ollamaLogger),
  logger: ollamaLogger,
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
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
    vi.clearAllMocks()
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

  it('probes the default host when self-hosted, so no configuration is required', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: ['llama3'] })
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/tags'), expect.anything())
  })

  it('reports an unreachable Ollama as an empty list rather than a failure', async () => {
    /**
     * A deployment that runs no Ollama refuses this connection on every poll. The
     * level is the point: an optional service being absent is not an error.
     */
    mockFetch.mockRejectedValue(new Error('Unable to connect. Is the computer able to access it?'))

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(ollamaLogger.error).not.toHaveBeenCalled()
    expect(ollamaLogger.info).toHaveBeenCalledWith(
      'Ollama service is not reachable, returning empty models',
      expect.objectContaining({ host: expect.any(String) })
    )
  })

  it('returns nothing when the provider is blacklisted', async () => {
    mockIsProviderBlacklisted.mockReturnValue(true)

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports an unreadable response as an error, not as absence', async () => {
    /**
     * Something answered 2xx but did not return a tag listing. Unlike a refused
     * connection that is a real fault, and must not be filed under "no Ollama here".
     */
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(ollamaLogger.error).toHaveBeenCalledWith(
      'Ollama returned a response this route cannot read',
      expect.objectContaining({ host: expect.any(String) })
    )
  })

  it('reports a non-2xx response as unavailable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(ollamaLogger.warn).toHaveBeenCalled()
    expect(ollamaLogger.error).not.toHaveBeenCalled()
  })

  it('reports a wrongly-shaped tag listing as an error', async () => {
    /** Reachable and 2xx, but the entries are not Ollama models. */
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [{ noName: true }] }) })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(ollamaLogger.error).toHaveBeenCalled()
  })

  it('accepts a listing with no models as simply empty', async () => {
    /** The schema defaults `models` to [], so an empty answer is not a fault. */
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(ollamaLogger.error).not.toHaveBeenCalled()
  })
})
