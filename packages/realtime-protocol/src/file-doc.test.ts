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
    expect(FILE_DOC_TIMEOUTS.seedRequestMs).toBeLessThan(FILE_DOC_TIMEOUTS.joinAckMs)
    expect(FILE_DOC_TIMEOUTS.joinAckMs).toBeLessThan(FILE_DOC_TIMEOUTS.readinessDeadlineMs)
  })
})
