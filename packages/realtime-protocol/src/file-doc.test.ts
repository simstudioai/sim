import { describe, expect, it } from 'vitest'
import { FILE_DOC_TIMEOUTS } from './file-doc'

describe('FILE_DOC_TIMEOUTS ordering invariants', () => {
  it('bounds every nested call below the one that wraps it', () => {
    // The relay's inner `/merge` fetch must finish before the app's outer `apply-edit` call gives up,
    // or the relay applies a merge after the caller has already returned (racing a follow-on edit).
    expect(FILE_DOC_TIMEOUTS.mergeRequestMs).toBeLessThan(FILE_DOC_TIMEOUTS.applyEditMs)
    // The relay's `/seed` fetch must finish before the client's readiness deadline lapses into its
    // read-only fallback, or a late-but-successful seed can never reach the client.
    expect(FILE_DOC_TIMEOUTS.seedRequestMs).toBeLessThan(FILE_DOC_TIMEOUTS.readinessDeadlineMs)
  })

  it('keeps the client flush wait well under the write budget it triggers', () => {
    // Deliberately NOT an "inner finishes before outer" invariant: the flush wait is an interaction
    // budget and the persist is a durable write budget. The client gives up FIRST and continues; the
    // write it started still completes server-side. Asserting the ordering pins that intent, so
    // raising the flush wait to "cover" a slow persist is a conscious change, not a drift.
    expect(FILE_DOC_TIMEOUTS.flushRequestMs).toBeLessThan(FILE_DOC_TIMEOUTS.persistRequestMs)
  })
})
