/**
 * `executionOrder` is not carried in the pause snapshot, so a resumed run used to
 * restart the counter at 0. A loop or parallel body that executes on both sides
 * of a pause would then reuse a pre-pause value.
 *
 * That is cosmetic for log ordering, but a `keyed` tool derives its provider
 * idempotency token from this number — two distinct writes would present the same
 * token and the provider would silently drop the second. Suppressing a real
 * payment is worse than the duplicate the token exists to prevent, because it
 * looks like success.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { BlockLog, ExecutionContext } from '@/executor/types'
import { getNextExecutionOrder } from '@/executor/types'

function log(executionOrder: number): BlockLog {
  return {
    blockId: `block-${executionOrder}`,
    blockName: `Block ${executionOrder}`,
    blockType: 'api',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 1,
    success: true,
    executionOrder,
  } as BlockLog
}

/** Mirrors how the executor seeds the counter when rebuilding a resumed context. */
function seedFromRestoredLogs(blockLogs: BlockLog[]): ExecutionContext {
  return {
    blockLogs,
    executionOrderCounter: {
      value: blockLogs.reduce((max, entry) => Math.max(max, entry.executionOrder ?? 0), 0),
    },
  } as unknown as ExecutionContext
}

describe('execution order across a resume', () => {
  it('continues past the highest pre-pause value instead of restarting', () => {
    const ctx = seedFromRestoredLogs([log(1), log(2), log(3)])

    expect(getNextExecutionOrder(ctx)).toBe(4)
    expect(getNextExecutionOrder(ctx)).toBe(5)
  })

  it('never reissues an order value a pre-pause invocation already used', () => {
    const before = [log(1), log(2), log(3)]
    const ctx = seedFromRestoredLogs(before)

    const after = [
      getNextExecutionOrder(ctx),
      getNextExecutionOrder(ctx),
      getNextExecutionOrder(ctx),
    ]

    const collisions = after.filter((order) =>
      before.some((entry) => entry.executionOrder === order)
    )
    expect(collisions).toEqual([])
  })

  it('starts at 1 for a fresh run with no restored logs', () => {
    const ctx = seedFromRestoredLogs([])

    expect(getNextExecutionOrder(ctx)).toBe(1)
  })

  it('tolerates a snapshot written before executionOrder was recorded', () => {
    const ctx = seedFromRestoredLogs([
      { ...log(1), executionOrder: undefined } as unknown as BlockLog,
    ])

    expect(getNextExecutionOrder(ctx)).toBe(1)
  })
})
