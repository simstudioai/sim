/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getExecutionRedisBudgetKeys } from '@/lib/execution/redis-budget.server'

describe('getExecutionRedisBudgetKeys', () => {
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
})
