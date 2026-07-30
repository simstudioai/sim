/**
 * @vitest-environment node
 */
import { newsletterAudienceRecipients, newsletterAudienceRuns } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResendExcludedEmails: vi.fn(),
}))

vi.mock('@/lib/newsletters/resend', () => ({
  getResendExcludedEmails: mocks.getResendExcludedEmails,
}))

import {
  createNewsletterCsvExport,
  markNewsletterRunPushed,
  resetFailedNewsletterRecipients,
  updateRecipientSyncStatus,
} from '@/lib/newsletters/runs'

const finalizedRun = {
  id: 'run-1',
  createdById: 'admin-1',
  name: 'Launch',
  prompt: 'Everyone',
  criteria: { type: 'everyone' },
  status: 'finalized',
  totalMatched: 1,
  excludedBanned: 0,
  excludedUnverified: 0,
  excludedUnsubscribed: 0,
  excludedSuppressed: 0,
  finalRecipientCount: 1,
  sampleRecipients: [],
  resendSegmentId: null,
  resendSegmentName: null,
  resendSyncedAt: null,
  snapshotVersion: 1,
  resendSyncAttempt: 0,
  resendSyncJobId: null,
  error: null,
  finalizedAt: new Date('2026-07-29T00:00:00.000Z'),
  createdAt: new Date('2026-07-29T00:00:00.000Z'),
  updatedAt: new Date('2026-07-29T00:00:00.000Z'),
}

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

describe('newsletter CSV export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(newsletterAudienceRuns, [finalizedRun])
    queueTableRows(newsletterAudienceRuns, [{ snapshotVersion: 1 }])
  })

  it('streams the header before scanning Resend exclusions', async () => {
    let resolveExclusions: ((value: Set<string>) => void) | undefined
    mocks.getResendExcludedEmails.mockImplementation(
      () =>
        new Promise<Set<string>>((resolve) => {
          resolveExclusions = resolve
        })
    )
    queueTableRows(newsletterAudienceRecipients, [])

    const { lines } = await createNewsletterCsvExport('run-1')

    expect(mocks.getResendExcludedEmails).not.toHaveBeenCalled()
    await expect(lines.next()).resolves.toEqual({
      done: false,
      value: 'email,first_name,last_name,sim_user_id,inclusion_reason',
    })
    expect(mocks.getResendExcludedEmails).not.toHaveBeenCalled()

    const nextLine = lines.next()
    await Promise.resolve()
    expect(mocks.getResendExcludedEmails).toHaveBeenCalledOnce()

    resolveExclusions?.(new Set())
    await expect(nextLine).resolves.toEqual({ done: true, value: undefined })
  })

  it('fails closed before querying or emitting recipient rows when Resend fails', async () => {
    mocks.getResendExcludedEmails.mockRejectedValueOnce(new Error('Resend unavailable'))
    const { lines } = await createNewsletterCsvExport('run-1')

    await expect(lines.next()).resolves.toMatchObject({ done: false })
    await expect(lines.next()).rejects.toThrow('Resend unavailable')

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })
})
