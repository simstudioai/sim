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

import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'

describe('requestExplicitStreamAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchGo.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('sends an explicit legacy protocol marker for strict Go admission', async () => {
    const result = await requestExplicitStreamAbort({
      streamId: 'stream-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
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

  it.each([true, false])('preserves the worker settlement acknowledgement: %s', async (settled) => {
    mockFetchGo.mockResolvedValue(Response.json({ stopped: true, settled }))
    await expect(
      requestExplicitStreamAbort({ streamId: 'stream-1', userId: 'user-1' })
    ).resolves.toEqual({ settled })
  })

  it.each([{ stopped: true }, { settled: 'true' }, null])(
    'does not invent settlement from %j',
    async (body) => {
      mockFetchGo.mockResolvedValue(Response.json(body))
      await expect(
        requestExplicitStreamAbort({ streamId: 'stream-1', userId: 'user-1' })
      ).resolves.toEqual({ settled: false })
    }
  )
})
