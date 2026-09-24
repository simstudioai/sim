/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({ COPILOT_API_KEY: 'sim-agent-key' })
})

afterAll(resetEnvMock)

const { mockFetchGo } = vi.hoisted(() => ({
  mockFetchGo: vi.fn(),
}))

vi.mock('@/lib/mothership/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: vi.fn().mockResolvedValue('https://copilot.test'),
  getMothershipSourceEnvHeaders: vi.fn().mockReturnValue({ 'X-Sim-Source-Env': 'test' }),
}))

import { AbortRequest } from '@/lib/mothership/generated/protocol'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'

describe('requestExplicitStreamAbort', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchGo.mockImplementation(async (_url, request) => {
      AbortRequest.parse(JSON.parse(request.body))
      return new Response(null, { status: 200 })
    })
  })

  it('sends an explicit legacy protocol marker for strict Go admission', async () => {
    const result = await requestExplicitStreamAbort({
      streamId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      chatId: 'chat-1',
    })
    expect(result).toEqual({ settled: false })

    expect(mockFetchGo).toHaveBeenCalledWith(
      'https://copilot.test/api/streams/explicit-abort',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sim-agent-key',
          'x-sim-billing-protocol': 'legacy-v0',
        }),
      })
    )
  })

  it('sends only the canonical stream signal after organization authorization', async () => {
    await requestExplicitStreamAbort({
      streamId: '11111111-1111-4111-8111-111111111111',
      userId: 'actor',
      chatId: 'chat',
    })
    const body = JSON.parse(mockFetchGo.mock.calls[0][1].body)
    expect(AbortRequest.parse(body)).toEqual({ messageId: '11111111-1111-4111-8111-111111111111' })
    expect(Object.keys(body)).toEqual(['messageId'])
  })

  it('waits for a worker that acknowledges Stop before it has finished settling', async () => {
    vi.useFakeTimers()
    let attempts = 0
    mockFetchGo.mockImplementation(async () =>
      Response.json({ stopped: true, settled: ++attempts >= 3 })
    )
    const stopping = requestExplicitStreamAbort({
      streamId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      timeoutMs: 6000,
    })
    await vi.runAllTimersAsync()
    await expect(stopping).resolves.toEqual({ settled: true })
    expect(mockFetchGo).toHaveBeenCalledTimes(3)
    expect(new Set(mockFetchGo.mock.calls.map(([, request]) => request.body)).size).toBe(1)
  })

  it('returns unsettled at its deadline instead of allowing the next turn to overlap', async () => {
    vi.useFakeTimers()
    mockFetchGo.mockImplementation(async () => Response.json({ stopped: true, settled: false }))
    const stopping = requestExplicitStreamAbort({
      streamId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      timeoutMs: 600,
    })
    await vi.runAllTimersAsync()
    await expect(stopping).resolves.toEqual({ settled: false })
    expect(mockFetchGo.mock.calls.length).toBeGreaterThan(1)
    expect(mockFetchGo.mock.lastCall?.[1].signal.aborted).toBe(true)
  })

  it('returns immediately once the worker reports settlement', async () => {
    mockFetchGo.mockResolvedValue(Response.json({ stopped: true, settled: true }))
    await expect(
      requestExplicitStreamAbort({
        streamId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
      })
    ).resolves.toEqual({ settled: true })
    expect(mockFetchGo).toHaveBeenCalledTimes(1)
  })

  it('keeps a real worker error visible instead of retrying it as a pending stop', async () => {
    mockFetchGo.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(
      requestExplicitStreamAbort({
        streamId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
      })
    ).rejects.toThrow('Explicit abort marker request failed: 503')
    expect(mockFetchGo).toHaveBeenCalledTimes(1)
  })

  it('bounds a hanging settlement recheck with the same deadline', async () => {
    vi.useFakeTimers()
    mockFetchGo
      .mockImplementationOnce(async () => Response.json({ settled: false }))
      .mockImplementation(
        (_url, request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), {
              once: true,
            })
          })
      )
    const stopping = requestExplicitStreamAbort({
      streamId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      timeoutMs: 600,
    })
    await vi.runAllTimersAsync()
    await expect(stopping).resolves.toEqual({ settled: false })
    expect(mockFetchGo).toHaveBeenCalledTimes(2)
  })

  it.each([{ stopped: true }, { settled: 'true' }, null])(
    'does not invent settlement from %j',
    async (body) => {
      mockFetchGo.mockResolvedValue(Response.json(body))
      await expect(
        requestExplicitStreamAbort({
          streamId: '11111111-1111-4111-8111-111111111111',
          userId: 'user-1',
        })
      ).resolves.toEqual({ settled: false })
      expect(mockFetchGo).toHaveBeenCalledTimes(1)
    }
  )
})
