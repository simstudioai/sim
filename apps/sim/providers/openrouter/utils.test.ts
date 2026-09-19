/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/providers/openai-compat/stream-events', () => ({
  createOpenAICompatibleAgentEventStream: vi.fn(),
}))
vi.mock('@/providers/utils', () => ({
  checkForForcedToolUsageOpenAI: vi.fn(),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenRouter model capabilities', () => {
  it('caches validated context lengths alongside existing capability flags', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'custom/small', context_length: 4096, supported_parameters: ['tools'] },
          {
            id: 'custom/large',
            context_length: 200_000,
            supported_parameters: ['structured_outputs'],
          },
        ],
      }),
    })
    const { getOpenRouterModelCapabilities } = await import('@/providers/openrouter/utils')
    const signal = new AbortController().signal
    expect(await getOpenRouterModelCapabilities('openrouter/custom/small', signal)).toEqual({
      supportsTools: true,
      supportsStructuredOutputs: false,
      contextWindow: 4096,
    })
    expect(await getOpenRouterModelCapabilities('OPENROUTER/custom/large')).toEqual({
      supportsTools: false,
      supportsStructuredOutputs: true,
      contextWindow: 200_000,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '4096', undefined])(
    'ignores an invalid dynamic context length %s',
    async (context_length) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'custom/model', context_length }] }),
      })
      const { getOpenRouterModelCapabilities } = await import('@/providers/openrouter/utils')
      expect(await getOpenRouterModelCapabilities('custom/model')).toEqual({
        supportsTools: false,
        supportsStructuredOutputs: false,
      })
    }
  )

  it('treats unavailable metadata as optional', async () => {
    fetchMock.mockRejectedValue(new Error('catalog unavailable'))
    const { getOpenRouterModelCapabilities } = await import('@/providers/openrouter/utils')
    expect(await getOpenRouterModelCapabilities('custom/model')).toBeNull()
  })

  it('bounds best-effort metadata retrieval without failing provider execution on timeout', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const { getOpenRouterModelCapabilities } = await import('@/providers/openrouter/utils')
    const pending = getOpenRouterModelCapabilities('custom/model')
    timeout.abort(new DOMException('metadata request timed out', 'TimeoutError'))
    await expect(pending).resolves.toBeNull()
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(5000)
  })

  it('propagates cancellation during metadata retrieval', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const { getOpenRouterModelCapabilities } = await import('@/providers/openrouter/utils')
    const pending = getOpenRouterModelCapabilities('custom/model', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
