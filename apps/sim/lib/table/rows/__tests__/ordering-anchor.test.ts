/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/table/planner'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import { appendAnchors, resolveInsertByNeighbor } from '@/lib/table/rows/ordering'

/**
 * A transaction whose anchor lookup finds nothing — the shape a caller produces
 * by naming a row id that does not exist in the table.
 */
function trxWithNoAnchor(): DbTransaction {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [],
  }
  return chain as unknown as DbTransaction
}

/**
 * `afterRowId`/`beforeRowId` name a neighbor the caller can get wrong — a stale
 * view, a concurrent delete, or a typo. The anchor lookup answered a miss with a
 * bare `Error`, which no error policy classifies, so `POST /tables/{id}/rows`
 * returned `500 INTERNAL_ERROR` for what is plainly a bad request.
 */
describe('resolveInsertByNeighbor > unknown anchor row', () => {
  it('classifies a missing afterRowId as not found, not an internal fault', async () => {
    const error = await resolveInsertByNeighbor(
      trxWithNoAnchor(),
      'table-1',
      'row_doesnotexist'
    ).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(TableRowNotFoundError)
    expect(error).toBeInstanceOf(OrchestrationError)
    expect((error as OrchestrationError).code).toBe('not_found')
    expect((error as Error).message).toContain('row_doesnotexist')
  })

  it('classifies a missing beforeRowId the same way', async () => {
    const error = await resolveInsertByNeighbor(
      trxWithNoAnchor(),
      'table-1',
      undefined,
      'row_alsomissing'
    ).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(TableRowNotFoundError)
    expect((error as OrchestrationError).code).toBe('not_found')
  })
})

/**
 * An append needs `max(order_key)` and the next `position`, and asks for both in one statement.
 * Two separate reads were two serial round trips inside the row-order advisory lock, which every
 * other inserting request on the table is queued behind.
 */
describe('appendAnchors', () => {
  function recordingTrx(row: { maxKey: string | null; maxPos: number }) {
    const projections: Array<Record<string, unknown>> = []
    const chain = {
      select: (projection: Record<string, unknown>) => {
        projections.push(projection)
        return chain
      },
      from: () => chain,
      where: async () => [row],
    }
    return { trx: chain as unknown as DbTransaction, projections }
  }

  it('reads both anchors in a single select', async () => {
    const { trx, projections } = recordingTrx({ maxKey: 'a5', maxPos: 7 })

    const anchors = await appendAnchors(trx, 'table-1')

    expect(projections).toHaveLength(1)
    expect(Object.keys(projections[0]).sort()).toEqual(['maxKey', 'maxPos'])
    expect(anchors).toEqual({ maxOrderKey: 'a5', nextPosition: 8 })
  })

  /** An empty table has no key to append after, and its first row takes position 0. */
  it('reports the empty table as no key and position zero', async () => {
    const { trx } = recordingTrx({ maxKey: null, maxPos: -1 })

    expect(await appendAnchors(trx, 'table-1')).toEqual({ maxOrderKey: null, nextPosition: 0 })
  })
})
