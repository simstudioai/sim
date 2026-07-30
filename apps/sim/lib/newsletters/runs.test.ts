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
  claimNewsletterRunResendAttempt,
  createNewsletterCsvExport,
  markNewsletterRunPushed,
  resetFailedNewsletterRecipients,
  setNewsletterRunResendJob,
  setNewsletterRunResendSegment,
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

  it('never asks callers to enqueue an already pushed run', async () => {
    queueTableRows(newsletterAudienceRuns, [
      {
        ...finalizedRun,
        status: 'pushed',
        resendSyncAttempt: 2,
        resendSyncJobId: null,
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const claim = await claimNewsletterRunResendAttempt('run-1')

    expect(claim.shouldEnqueue).toBe(false)
    expect(claim.jobId).toBeNull()
  })

  it('preserves established pushed job tracking', async () => {
    queueTableRows(newsletterAudienceRuns, [
      {
        ...finalizedRun,
        status: 'pushed',
        resendSyncAttempt: 2,
        resendSyncJobId: 'job-winner',
      },
    ])

    const result = await setNewsletterRunResendJob('run-1', 2, 'job-late')

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(result.resendSyncJobId).toBe('job-winner')
  })

  it('fills missing pushed job tracking without changing the pushed state', async () => {
    const pushedRun = {
      ...finalizedRun,
      status: 'pushed',
      resendSyncAttempt: 2,
      resendSyncJobId: null,
    }
    queueTableRows(newsletterAudienceRuns, [pushedRun])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...pushedRun, resendSyncJobId: 'job-accepted' },
    ])

    const result = await setNewsletterRunResendJob('run-1', 2, 'job-accepted')

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(result.status).toBe('pushed')
    expect(result.resendSyncJobId).toBe('job-accepted')
  })

  it('does not overwrite a segment after the run is pushed', async () => {
    const pushedRun = {
      ...finalizedRun,
      status: 'pushed',
      resendSyncAttempt: 2,
      resendSegmentId: 'segment-winner',
      resendSegmentName: 'Winner segment',
    }
    queueTableRows(newsletterAudienceRuns, [pushedRun])

    const result = await setNewsletterRunResendSegment('run-1', 2, 'segment-late', 'Late segment')

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(result.resendSegmentId).toBe('segment-winner')
  })

  it('keeps the first segment persisted by same-attempt workers', async () => {
    const runWithSegment = {
      ...finalizedRun,
      status: 'pushing',
      resendSyncAttempt: 2,
      resendSegmentId: 'segment-first',
      resendSegmentName: 'First segment',
    }
    queueTableRows(newsletterAudienceRuns, [runWithSegment])

    const result = await setNewsletterRunResendSegment(
      'run-1',
      2,
      'segment-second',
      'Second segment'
    )

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(result.resendSegmentId).toBe('segment-first')
  })

  it('locks the run while persisting the first segment', async () => {
    const pushingRun = {
      ...finalizedRun,
      status: 'pushing',
      resendSyncAttempt: 2,
    }
    queueTableRows(newsletterAudienceRuns, [pushingRun])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        ...pushingRun,
        resendSegmentId: 'segment-first',
        resendSegmentName: 'First segment',
      },
    ])

    const result = await setNewsletterRunResendSegment('run-1', 2, 'segment-first', 'First segment')

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(result.resendSegmentId).toBe('segment-first')
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
