/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { coldConnectionBudgetMs } from '@/lib/core/config/redis-budget'

describe('coldConnectionBudgetMs', () => {
  it('charges an unanswered handshake at two command deadlines plus the half-close wait', () => {
    // Unauthenticated: SETNAME/SETINFO time out, then INFO times out, then the
    // half-closed socket waits for a FIN a wedged peer never sends.
    expect(
      coldConnectionBudgetMs({
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 5_000,
        disconnectTimeoutMs: 2_000,
        reconnectDelayMs: 500,
      })
    ).toBe(2 * 5_000 + 2_000 + 500 + 1_000)
  })

  it('charges the connect deadline when a connection that never completes is the longer case', () => {
    // Lowering the command deadline must not shrink the budget below what a
    // connect that never completes costs before retryStrategy can fire.
    expect(
      coldConnectionBudgetMs({
        connectTimeoutMs: 10_000,
        commandTimeoutMs: 3_000,
        disconnectTimeoutMs: 2_000,
        reconnectDelayMs: 500,
      })
    ).toBe(10_000 + 500 + 1_000)
  })

  it('always leaves room for the healthy attempt that follows the reconnect', () => {
    expect(
      coldConnectionBudgetMs({
        connectTimeoutMs: 0,
        commandTimeoutMs: 0,
        disconnectTimeoutMs: 0,
        reconnectDelayMs: 0,
      })
    ).toBe(1_000)
  })
})
