/**
 * @vitest-environment node
 */
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import {
  type BackgroundRetryDecision,
  type BackgroundRetryPolicy,
  backgroundRetryAttemptCeiling,
  getBackgroundRetryDecision,
  getDatabaseRetryAt,
} from '@/lib/core/errors/background-retry'

const MINUTE = 60 * 1000
const POLICY: BackgroundRetryPolicy = {
  maxAttempts: 3,
  database: { maxAttempts: 6, baseDelayMs: 2 * MINUTE, maxDelayMs: 30 * MINUTE },
}
const NOW = Date.parse('2026-01-01T00:00:00.000Z')

function failedQuery(code: string, message = 'private driver detail'): DrizzleQueryError {
  return new DrizzleQueryError(
    'private SQL',
    ['private'],
    Object.assign(new Error(message), { code })
  )
}

function delayOf(decision: BackgroundRetryDecision): number {
  if (!decision || !('retryAt' in decision)) throw new Error('expected a scheduled retry')
  return decision.retryAt.getTime() - NOW
}

describe('getBackgroundRetryDecision', () => {
  it.each([
    ['capacity', failedQuery('57014', 'canceling statement due to statement timeout')],
    ['conflict', failedQuery('40P01', 'deadlock detected')],
    ['connection', failedQuery('CONNECTION_CLOSED')],
  ])('waits minutes after a %s failure', (_label, error) => {
    const delay = delayOf(getBackgroundRetryDecision(error, 1, POLICY, NOW))
    expect(delay).toBeGreaterThanOrEqual(2 * MINUTE * 0.8)
    expect(delay).toBeLessThanOrEqual(2 * MINUTE * 1.2)
  })

  it('doubles the delay per attempt up to the ceiling', () => {
    const error = failedQuery('55P03')
    const delays = [1, 2, 3, 4, 5].map((attempt) =>
      delayOf(getBackgroundRetryDecision(error, attempt, POLICY, NOW))
    )
    const bases = [2, 4, 8, 16, 30].map((minutes) => minutes * MINUTE)
    delays.forEach((delay, index) => {
      expect(delay).toBeGreaterThanOrEqual(bases[index] * 0.8)
      expect(delay).toBeLessThanOrEqual(bases[index] * 1.2)
    })
    const longPolicy = { ...POLICY, database: { ...POLICY.database, maxAttempts: 20 } }
    expect(delayOf(getBackgroundRetryDecision(error, 12, longPolicy, NOW))).toBeLessThanOrEqual(
      30 * MINUTE * 1.2
    )
  })

  it('stops database retries at their own attempt ceiling', () => {
    const error = failedQuery('53300')
    expect(getBackgroundRetryDecision(error, 5, POLICY, NOW)).toHaveProperty('retryAt')
    expect(getBackgroundRetryDecision(error, 6, POLICY, NOW)).toEqual({ skipRetrying: true })
  })

  it('keeps the task default for other failures until their attempt ceiling', () => {
    const error = failedQuery('23505')
    expect(getBackgroundRetryDecision(error, 1, POLICY, NOW)).toBeUndefined()
    expect(getBackgroundRetryDecision(error, 2, POLICY, NOW)).toBeUndefined()
    expect(getBackgroundRetryDecision(error, 3, POLICY, NOW)).toEqual({ skipRetrying: true })
  })

  it('does not stretch an explicit cancellation onto the database pacing', () => {
    const cancelled = failedQuery('57014', 'canceling statement due to user request')
    expect(getBackgroundRetryDecision(cancelled, 1, POLICY, NOW)).toBeUndefined()
  })
})

describe('getDatabaseRetryAt', () => {
  it('returns null for a failure that is not a transient database failure', () => {
    expect(getDatabaseRetryAt(new Error('parser failed'), 1, POLICY, NOW)).toBeNull()
  })

  it('returns null once the database attempts are spent', () => {
    expect(getDatabaseRetryAt(failedQuery('40001'), 6, POLICY, NOW)).toBeNull()
  })
})

describe('backgroundRetryAttemptCeiling', () => {
  it('covers whichever kind of failure retries longer', () => {
    expect(backgroundRetryAttemptCeiling(POLICY)).toBe(6)
    expect(backgroundRetryAttemptCeiling({ ...POLICY, maxAttempts: 8 })).toBe(8)
  })
})
