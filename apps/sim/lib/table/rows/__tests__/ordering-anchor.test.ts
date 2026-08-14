/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/table/planner'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import { resolveInsertByNeighbor } from '@/lib/table/rows/ordering'

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
