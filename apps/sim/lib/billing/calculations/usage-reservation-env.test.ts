/**
 * @vitest-environment node
 */
import { redisConfigMock, redisConfigMockFns, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { evalMock, mockEnv } = vi.hoisted(() => ({
  evalMock: vi.fn(),
  mockEnv: {
    BILLING_CONCURRENCY_LIMIT_FREE: '11',
    BILLING_CONCURRENCY_LIMIT_PRO: '55',
    BILLING_CONCURRENCY_LIMIT_TEAM: '222',
    BILLING_CONCURRENCY_LIMIT_ENTERPRISE: '1111',
  },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  envNumber: (
    value: number | string | undefined | null,
    fallback: number,
    options: { min?: number; integer?: boolean } = {}
  ) => {
    const parsed = Number(value)
    const min = options.min ?? 0
    return Number.isFinite(parsed) &&
      parsed >= min &&
      (!options.integer || Number.isInteger(parsed))
      ? parsed
      : fallback
  },
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import { reserveExecutionSlot } from '@/lib/billing/calculations/usage-reservation'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true, isHosted: true })
})

afterAll(resetEnvFlagsMock)

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
