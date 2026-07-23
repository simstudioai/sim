/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Free-tier env values are baked into RATE_LIMITS at module load, while the
 * billing-disabled opt-in check reads them at call time. Seeding them here
 * mirrors production, where both reads observe the same process env.
 */
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    RATE_LIMIT_FREE_SYNC: '25',
    RATE_LIMIT_FREE_API_ENDPOINT: '10',
  } as Record<string, string | undefined>,
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import { getRateLimit } from '@/lib/core/rate-limiter/types'

afterAll(resetEnvFlagsMock)

describe('getRateLimit', () => {
  beforeEach(() => {
    setEnvFlags({ isBillingEnabled: true })
    mockEnv.RATE_LIMIT_FREE_SYNC = '25'
    mockEnv.RATE_LIMIT_FREE_API_ENDPOINT = '10'
  })

  it('applies per-tier limits when billing is enabled', () => {
    expect(getRateLimit('pro_6000', 'sync').refillRate).toBe(150)
    expect(getRateLimit('team_6000', 'sync').refillRate).toBe(150)
    expect(getRateLimit('pro_25000', 'sync').refillRate).toBe(300)
    expect(getRateLimit('team_25000', 'sync').refillRate).toBe(300)
  })

  it('is effectively unlimited when billing is disabled and no free env is set', () => {
    setEnvFlags({ isBillingEnabled: false })
    mockEnv.RATE_LIMIT_FREE_SYNC = undefined
    mockEnv.RATE_LIMIT_FREE_API_ENDPOINT = undefined

    expect(getRateLimit('free', 'sync').refillRate).toBe(999999)
    expect(getRateLimit('free', 'async').refillRate).toBe(999999)
    expect(getRateLimit('free', 'api-endpoint').refillRate).toBe(999999)
  })

  it('opts back into enforcement per counter when a free env var is explicitly set', () => {
    setEnvFlags({ isBillingEnabled: false })

    expect(getRateLimit('free', 'sync').refillRate).toBe(25)
    expect(getRateLimit('free', 'api-endpoint').refillRate).toBe(10)
    expect(getRateLimit('free', 'async').refillRate).toBe(999999)
  })
})
