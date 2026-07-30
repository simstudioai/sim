/**
 * @vitest-environment node
 */
import { newsletterAudienceRecipients, newsletterAudienceRuns } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/newsletters/resend', () => ({
  getResendExcludedEmails: vi.fn(),
}))

import {
  markNewsletterRunPushed,
  resetFailedNewsletterRecipients,
  updateRecipientSyncStatus,
} from '@/lib/newsletters/runs'

afterAll(resetDbChainMock)

describe('newsletter Resend state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('locks the run while checking recipients and publishing', async () => {
    queueTableRows(newsletterAudienceRuns, [
      { status: 'pushing', snapshotVersion: 3, resendSyncAttempt: 2 },
    ])
    queueTableRows(newsletterAudienceRecipients, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'run-1' }])

    await markNewsletterRunPushed('run-1', 2, 'segment-1', 'Segment 1')

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('rejects publishing when recipients remain incomplete', async () => {
    queueTableRows(newsletterAudienceRuns, [
      { status: 'pushing', snapshotVersion: 3, resendSyncAttempt: 2 },
    ])
    queueTableRows(newsletterAudienceRecipients, [{ id: 'recipient-1' }])

    await expect(markNewsletterRunPushed('run-1', 2, 'segment-1', 'Segment 1')).rejects.toThrow(
      'recipients remain pending or failed'
    )

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('locks and attempt-fences failed-recipient resets', async () => {
    queueTableRows(newsletterAudienceRuns, [
      { status: 'pushing', snapshotVersion: 3, resendSyncAttempt: 2 },
    ])

    await resetFailedNewsletterRecipients('run-1', 2)

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })

  it('locks and attempt-fences recipient status updates', async () => {
    queueTableRows(newsletterAudienceRuns, [
      { status: 'pushing', snapshotVersion: 3, resendSyncAttempt: 2 },
    ])

    await updateRecipientSyncStatus('run-1', 2, 3, 'user@example.com', 'failed', {
      error: 'Resend failed',
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
  })
})
