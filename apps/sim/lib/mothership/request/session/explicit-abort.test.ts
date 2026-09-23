/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it.each([true, false])('preserves the worker settlement acknowledgement: %s', async (settled) => {
    mockFetchGo.mockResolvedValue(Response.json({ stopped: true, settled }))
    await expect(
      requestExplicitStreamAbort({
        streamId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
      })
    ).resolves.toEqual({ settled })
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
    }
  )
})
