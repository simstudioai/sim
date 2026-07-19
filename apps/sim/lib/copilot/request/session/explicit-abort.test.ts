/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/core/config/env', () => ({
  env: { COPILOT_API_KEY: 'sim-agent-key' },
  getEnv: vi.fn().mockReturnValue(undefined),
  isTruthy: (value: unknown) => Boolean(value),
  isFalsy: (value: unknown) => value === false,
  envNumber: (val: unknown, fallback: number) => {
    const n = typeof val === 'string' ? Number(val) : (val as number)
    return Number.isFinite(n) ? n : fallback
  },
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
