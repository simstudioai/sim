/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  getExecutionRedisBudgetKeys,
  reserveExecutionRedisBytes,
} from '@/lib/execution/redis-budget.server'

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function captureReserveScript(userId?: string): Promise<string> {
  let script = ''
  const redis = {
    eval: vi.fn(async (source: string) => {
      script = source
      return [1, 'ok', 0, 0]
    }),
  }

  await reserveExecutionRedisBytes(redis as never, {
    executionId: 'exec-1',
    userId,
    category: 'event_buffer',
    operation: 'write_events',
    bytes: 128,
  })

  return script
}

describe('reserveExecutionRedisBytes', () => {
  it('scopes the reservation to the execution, and to the user when one is known', () => {
    expect(
      getExecutionRedisBudgetKeys({
        executionId: 'exec-1',
        category: 'event_buffer',
        operation: 'write_events',
        bytes: 1,
      })
    ).toEqual(['execution:redis-budget:execution:exec-1'])

    expect(
      getExecutionRedisBudgetKeys({
        executionId: 'exec-1',
        userId: 'user-1',
        category: 'event_buffer',
        operation: 'write_events',
        bytes: 1,
      })
    ).toEqual(['execution:redis-budget:execution:exec-1', 'execution:redis-budget:user:user-1'])
  })

  /**
   * A user key aggregates across every execution that user runs, so extending
   * its TTL on each write keeps it alive indefinitely while the per-execution
   * data it accounts for expires underneath it. The window must be fixed.
   */
  it('never extends an existing user budget window', async () => {
    const script = await captureReserveScript('user-1')

    const userKeyExpires = countOccurrences(script, "redis.call('EXPIRE', KEYS[2]")
    const userKeyTtlGuards = countOccurrences(script, "redis.call('TTL', KEYS[2]) < 0")
    expect(userKeyExpires).toBeGreaterThan(0)
    expect(userKeyTtlGuards).toBe(userKeyExpires)
  })

  it('keeps sliding the execution budget window, which expires with its own data', async () => {
    const script = await captureReserveScript('user-1')

    expect(countOccurrences(script, "redis.call('TTL', KEYS[1]) < 0")).toBe(0)
    expect(countOccurrences(script, "redis.call('EXPIRE', KEYS[1]")).toBeGreaterThan(0)
  })
})
