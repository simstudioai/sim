/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { usageLimitsResponseSchema } from '@/lib/api/contracts/usage-limits'

const VALID_RESPONSE = {
  success: true,
  rateLimit: {
    sync: {
      isLimited: false,
      requestsPerMinute: 100,
      maxBurst: 200,
      remaining: 99,
      resetAt: '2026-08-11T12:00:00.000Z',
    },
    async: {
      isLimited: true,
      requestsPerMinute: 50,
      maxBurst: 100,
      remaining: 0,
      resetAt: '2026-08-11T12:01:00.000Z',
    },
    authType: 'manual',
  },
  usage: {
    currentPeriodCost: 12.5,
    limit: 100,
    plan: 'pro',
  },
  storage: {
    usedBytes: 250,
    limitBytes: 1_000,
    percentUsed: 25,
  },
} as const

describe('usageLimitsResponseSchema', () => {
  it('accepts the complete legacy response', () => {
    expect(usageLimitsResponseSchema.parse(VALID_RESPONSE)).toEqual(VALID_RESPONSE)
  })

  it('rejects a response that drops legacy rate-limit data', () => {
    const { rateLimit: _, ...responseWithoutRateLimit } = VALID_RESPONSE

    expect(() => usageLimitsResponseSchema.parse(responseWithoutRateLimit)).toThrow()
  })
})
