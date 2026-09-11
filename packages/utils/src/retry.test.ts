import { describe, expect, it } from 'vitest'
import { coldConnectionBudgetMs } from './retry'

describe('coldConnectionBudgetMs', () => {
  it('charges a dead handshake at two command deadlines when that exceeds the connect deadline', () => {
    // Unauthenticated: SETNAME/SETINFO settle by timing out before INFO starts its own deadline.
    expect(
      coldConnectionBudgetMs({
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 2_000,
        reconnectDelayMs: 500,
      })
    ).toBe(2 * 2_000 + 500 + 1_000)
  })

  it('charges the connect deadline when a connection that never completes is the longer case', () => {
    // Lowering the command deadline must not shrink the budget below what a
    // connect that never completes costs before retryStrategy can fire.
    expect(
      coldConnectionBudgetMs({
        connectTimeoutMs: 10_000,
        commandTimeoutMs: 3_000,
        reconnectDelayMs: 500,
      })
    ).toBe(10_000 + 500 + 1_000)
  })

  it('always leaves room for the healthy attempt that follows the reconnect', () => {
    expect(
      coldConnectionBudgetMs({ connectTimeoutMs: 0, commandTimeoutMs: 0, reconnectDelayMs: 0 })
    ).toBe(1_000)
  })
})
