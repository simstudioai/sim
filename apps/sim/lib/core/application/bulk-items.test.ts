/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { type BulkItemDisposition, classifyBulkItemError } from '@/lib/core/application/bulk-items'
import { OrchestrationError } from '@/lib/core/orchestration/types'

describe('classifyBulkItemError', () => {
  /**
   * The invariant this function exists to hold: an id the caller may not reach
   * and an id that does not exist must be indistinguishable in the response,
   * or a bulk request becomes a membership oracle for a workspace the caller
   * can read but not write to.
   */
  it.each(['not_found', 'forbidden', 'unauthorized'] as const)(
    'conceals %s as notFound, carrying no message',
    (code) => {
      const disposition = classifyBulkItemError(
        new OrchestrationError(code, `secret detail for ${code}`)
      )

      expect(disposition).toEqual({ kind: 'notFound' })
    }
  )

  it('reports any other classified code as an actionable per-item failure', () => {
    expect(
      classifyBulkItemError(new OrchestrationError('validation', 'Bad target folder'))
    ).toEqual({ kind: 'failed', reason: 'Bad target folder' })
    expect(classifyBulkItemError(new OrchestrationError('conflict', 'Name taken'))).toEqual({
      kind: 'failed',
      reason: 'Name taken',
    })
  })

  it('ends the batch on an internal or unclassified error', () => {
    const internal = new OrchestrationError('internal', 'connection reset')
    expect(classifyBulkItemError(internal)).toEqual({ kind: 'terminal', error: internal })

    const unclassified = new Error('socket hang up')
    expect(classifyBulkItemError(unclassified)).toEqual({
      kind: 'terminal',
      error: unclassified,
    })
  })

  it('lets a domain verdict rule on an error the shared classification cannot see', () => {
    class DomainLockError extends Error {}
    const verdict = (error: unknown): BulkItemDisposition | undefined =>
      error instanceof DomainLockError ? { kind: 'failed', reason: error.message } : undefined

    expect(classifyBulkItemError(new DomainLockError('Table is locked'), verdict)).toEqual({
      kind: 'failed',
      reason: 'Table is locked',
    })
    // Without the verdict the same error is an unclassified fault that ends the batch.
    expect(classifyBulkItemError(new DomainLockError('Table is locked'))).toMatchObject({
      kind: 'terminal',
    })
  })

  /**
   * A verdict must not be able to reopen the probe the concealment closes: the
   * concealed codes are decided before the hook could widen them.
   */
  it('keeps concealment ahead of a domain verdict that would widen it', () => {
    const leakyVerdict = (error: unknown): BulkItemDisposition => ({
      kind: 'failed',
      reason: `leaked: ${(error as Error).message}`,
    })

    for (const code of ['not_found', 'forbidden', 'unauthorized'] as const) {
      expect(
        classifyBulkItemError(new OrchestrationError(code, 'no write access'), leakyVerdict)
      ).toEqual({ kind: 'notFound' })
    }
  })
})
