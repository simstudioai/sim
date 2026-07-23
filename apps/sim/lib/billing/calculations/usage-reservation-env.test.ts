/**
 * @vitest-environment node
 */
import {
  redisConfigMockFns,
  resetEnvFlagsMock,
  resetEnvMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { evalMock } = vi.hoisted(() => ({
  evalMock: vi.fn(),
}))

import { reserveExecutionSlot } from '@/lib/billing/calculations/usage-reservation'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true, isHosted: true })
  setEnv({
    BILLING_CONCURRENCY_LIMIT_FREE: '11',
    BILLING_CONCURRENCY_LIMIT_PRO: '55',
    BILLING_CONCURRENCY_LIMIT_TEAM: '222',
    BILLING_CONCURRENCY_LIMIT_ENTERPRISE: '1111',
  })
})

afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

describe('usage reservation environment overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    evalMock.mockResolvedValue(1)
    redisConfigMockFns.mockGetRedisClient.mockReturnValue({
      eval: evalMock,
      get: vi.fn(),
    })
  })

  it.each([
    ['free', '11'],
    ['pro_6000', '55'],
    ['team_6000', '55'],
    ['pro_25000', '222'],
    ['team_25000', '222'],
    ['enterprise', '1111'],
  ] as const)('uses the %s plan override', async (plan, expected) => {
    await reserveExecutionSlot({
      billingEntity: { type: 'user', id: 'user-1' },
      reservationId: `exec-${plan}`,
      plan,
      currentUsage: 0,
      limit: 100,
    })

    expect(evalMock.mock.calls[0][6]).toBe(expected)
  })
})
