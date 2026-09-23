/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canRetryDocumentProcessing,
  QUEUED_DISPATCH_GRACE_MS,
} from '@/lib/knowledge/documents/types'

const NOW = Date.parse('2026-09-01T12:00:00.000Z')
const beforeGrace = (ms: number) => new Date(NOW - QUEUED_DISPATCH_GRACE_MS - ms).toISOString()
const withinGrace = new Date(NOW - QUEUED_DISPATCH_GRACE_MS + 60_000).toISOString()
const LONG_AGO = new Date(0).toISOString()

describe('canRetryDocumentProcessing', () => {
  it('offers a retry for a failed document', () => {
    expect(
      canRetryDocumentProcessing({ processingStatus: 'failed', uploadedAt: LONG_AGO }, NOW)
    ).toBe(true)
  })

  it.each(['completed', 'processing'])('does not offer a retry for a %s document', (status) => {
    expect(
      canRetryDocumentProcessing({ processingStatus: status, uploadedAt: LONG_AGO }, NOW)
    ).toBe(false)
  })

  it('does not offer a retry for a skipped document', () => {
    expect(
      canRetryDocumentProcessing(
        { processingStatus: 'failed', processingOutcome: 'skipped', uploadedAt: LONG_AGO },
        NOW
      )
    ).toBe(false)
  })

  it('offers a retry once a deferred retry is past the grace the retry API applies', () => {
    const lost = {
      processingStatus: 'pending',
      processingQueuedAt: LONG_AGO,
      processingDeferredUntil: beforeGrace(60_000),
      uploadedAt: LONG_AGO,
    }
    expect(canRetryDocumentProcessing(lost, NOW)).toBe(true)
    expect(canRetryDocumentProcessing({ ...lost, processingDeferredUntil: withinGrace }, NOW)).toBe(
      false
    )
  })

  it('waits the same grace after the dispatch when nothing was deferred', () => {
    const queued = { processingStatus: 'pending', uploadedAt: LONG_AGO }
    expect(canRetryDocumentProcessing({ ...queued, processingQueuedAt: withinGrace }, NOW)).toBe(
      false
    )
    expect(
      canRetryDocumentProcessing({ ...queued, processingQueuedAt: beforeGrace(60_000) }, NOW)
    ).toBe(true)
    expect(
      canRetryDocumentProcessing({ processingStatus: 'pending', uploadedAt: withinGrace }, NOW)
    ).toBe(false)
  })
})
