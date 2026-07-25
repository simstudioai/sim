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

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: vi.fn().mockResolvedValue('https://copilot.test'),
  getMothershipSourceEnvHeaders: vi.fn().mockReturnValue({ 'X-Sim-Source-Env': 'test' }),
}))

import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'

describe('requestExplicitStreamAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchGo.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('sends an explicit legacy protocol marker for strict Go admission', async () => {
    await requestExplicitStreamAbort({
      streamId: 'stream-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

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
})
