import { beforeEach, describe, expect, it, vi } from 'vitest'

const ping = vi.fn()

vi.mock('@/lib/core/config/env', () => ({
  env: {
    FULLSTACK_DEMO_MODE: true,
    NEXT_PUBLIC_FULLSTACK_DEMO_MODE: true,
    COPILOT_API_KEY: 'test-key',
    REDIS_URL: 'redis://localhost:6379',
    SIM_AGENT_API_URL: 'https://www.copilot.sim.ai',
  },
  isTruthy: (value: unknown) =>
    typeof value === 'string'
      ? value.toLowerCase() === 'true' || value === '1'
      : Boolean(value),
}))

vi.mock('@/lib/copilot/constants', () => ({
  SIM_AGENT_API_URL: 'https://www.copilot.sim.ai',
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => ({ ping }),
}))

describe('assertHostedDemoRuntime', () => {
  beforeEach(() => {
    ping.mockReset()
    ping.mockResolvedValue('PONG')
  })

  it('passes for hosted URL + key + redis', async () => {
    const { assertHostedDemoRuntime } = await import('@/lib/apps/demo/runtime')
    const result = await assertHostedDemoRuntime()
    expect(result).toEqual({ ok: true })
  })
})
