/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getRedisBudgetKeys, getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'

describe('getRedisBudgetKeys', () => {
  it('charges the owner only when no user is in scope', () => {
    expect(getRedisBudgetKeys({ kind: 'execution', id: 'exec-1' })).toEqual([
      'execution:redis-budget:execution:exec-1',
    ])
  })

  it('charges the owner and the user when a user is in scope', () => {
    expect(getRedisBudgetKeys({ kind: 'execution', id: 'exec-1', userId: 'user-1' })).toEqual([
      'execution:redis-budget:execution:exec-1',
      'execution:redis-budget:user:user-1',
    ])
  })

  /**
   * These keys are shared with counters written before this module existed, so the
   * layout is a wire contract: a change here strands every counter in flight.
   */
  it('separates owner kinds without disturbing the execution key layout', () => {
    expect(
      getRedisBudgetKeys({ kind: 'copilot_stream', id: 'stream-1', userId: 'user-1' })
    ).toEqual([
      'execution:redis-budget:copilot_stream:stream-1',
      'execution:redis-budget:user:user-1',
    ])
  })

  it('shares one user ceiling across owner kinds', () => {
    const [, executionUserKey] = getRedisBudgetKeys({
      kind: 'execution',
      id: 'exec-1',
      userId: 'user-1',
    })
    const [, streamUserKey] = getRedisBudgetKeys({
      kind: 'copilot_stream',
      id: 'stream-1',
      userId: 'user-1',
    })
    expect(streamUserKey).toBe(executionUserKey)
  })
})

describe('getRedisBudgetLimits', () => {
  it('preserves the ceilings the execution buffer has always enforced', () => {
    expect(getRedisBudgetLimits('execution')).toEqual({
      maxSingleWriteBytes: 8 * 1024 * 1024,
      maxOwnerBytes: 64 * 1024 * 1024,
      maxUserBytes: 256 * 1024 * 1024,
      ttlSeconds: 60 * 60,
    })
  })
})
