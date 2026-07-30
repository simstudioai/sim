/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimAttempt: vi.fn(),
  countByStatus: vi.fn(),
  createSegment: vi.fn(),
  ensureProperties: vi.fn(),
  getAsyncBackendType: vi.fn(),
  getExcludedEmails: vi.fn(),
  getJobQueue: vi.fn(),
  getPendingRecipients: vi.fn(),
  isAsyncJobEnqueueError: vi.fn(),
  markFailed: vi.fn(),
  markPushed: vi.fn(),
  queueCancel: vi.fn(),
  queueEnqueue: vi.fn(),
  queueGetJob: vi.fn(),
  requireAttempt: vi.fn(),
  resetFailedRecipients: vi.fn(),
  setJob: vi.fn(),
  setSegment: vi.fn(),
  updateRecipient: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getAsyncBackendType: mocks.getAsyncBackendType,
  getJobQueue: mocks.getJobQueue,
  isAsyncJobEnqueueError: mocks.isAsyncJobEnqueueError,
  JOB_STATUS: {
    COMPLETED: 'completed',
    FAILED: 'failed',
    PENDING: 'pending',
    PROCESSING: 'processing',
  },
}))

vi.mock('@/lib/newsletters/resend', () => ({
  createNewsletterSegment: mocks.createSegment,
  createOrSegmentNewsletterContact: vi.fn(),
  ensureNewsletterContactProperties: mocks.ensureProperties,
  getResendExcludedEmails: mocks.getExcludedEmails,
}))

vi.mock('@/lib/newsletters/runs', () => ({
  claimNewsletterRunResendAttempt: mocks.claimAttempt,
  countNewsletterRecipientsByStatus: mocks.countByStatus,
  getPendingNewsletterRecipients: mocks.getPendingRecipients,
  markNewsletterRunPushed: mocks.markPushed,
  markNewsletterRunPushFailed: mocks.markFailed,
  requireNewsletterRunAttempt: mocks.requireAttempt,
  resetFailedNewsletterRecipients: mocks.resetFailedRecipients,
  setNewsletterRunResendJob: mocks.setJob,
  setNewsletterRunResendSegment: mocks.setSegment,
  updateRecipientSyncStatus: mocks.updateRecipient,
}))

import { enqueueNewsletterResendSync, runNewsletterResendSync } from '@/lib/newsletters/push-resend'

const run = {
  id: 'run-1',
  name: 'Launch',
  status: 'pushing',
  resendSegmentId: 'segment-1',
  resendSegmentName: 'Segment 1',
  resendSyncJobId: null,
}

describe('newsletter Resend queueing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAsyncBackendType.mockReturnValue('trigger-dev')
    mocks.getJobQueue.mockResolvedValue({
      cancelJob: mocks.queueCancel,
      enqueue: mocks.queueEnqueue,
      getJob: mocks.queueGetJob,
    })
    mocks.claimAttempt.mockResolvedValue({
      attempt: 2,
      jobId: null,
      run,
      shouldEnqueue: true,
    })
    mocks.queueEnqueue.mockResolvedValue('trigger-run-123')
    mocks.setJob.mockResolvedValue({ ...run, resendSyncJobId: 'trigger-run-123' })
    mocks.isAsyncJobEnqueueError.mockReturnValue(false)
  })

  it('stores the provider job id returned by the queue', async () => {
    const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 2, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_2', maxAttempts: 3 })
    )
    expect(mocks.setJob).toHaveBeenCalledWith('run-1', 2, 'trigger-run-123')
    expect(mocks.resetFailedRecipients).not.toHaveBeenCalled()
    expect(result.jobId).toBe('trigger-run-123')
  })

  it('leaves an uncertain enqueue attempt resumable', async () => {
    const error = new Error('response lost')
    mocks.queueEnqueue.mockRejectedValue(error)
    mocks.isAsyncJobEnqueueError.mockReturnValue(true)

    await expect(enqueueNewsletterResendSync('run-1', 'admin-1')).rejects.toThrow('response lost')
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('does not mark an accepted job failed when provider-id persistence fails', async () => {
    mocks.setJob.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(enqueueNewsletterResendSync('run-1', 'admin-1')).rejects.toThrow(
      'database unavailable'
    )
    expect(mocks.queueEnqueue).toHaveBeenCalledTimes(1)
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('re-enters a persisted database job so an expired claim can be recovered', async () => {
    mocks.getAsyncBackendType.mockReturnValue('database')
    mocks.claimAttempt.mockResolvedValue({
      attempt: 2,
      jobId: 'newsletter_resend_run-1_2',
      run: { ...run, resendSyncJobId: 'newsletter_resend_run-1_2' },
      shouldEnqueue: false,
    })
    mocks.queueGetJob.mockResolvedValue({
      id: 'newsletter_resend_run-1_2',
      status: 'processing',
    })
    mocks.queueEnqueue.mockResolvedValue('newsletter_resend_run-1_2')
    mocks.setJob.mockResolvedValue({
      ...run,
      resendSyncJobId: 'newsletter_resend_run-1_2',
    })

    await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 2, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_2' })
    )
  })

  it('starts a new attempt when a persisted Trigger.dev job failed', async () => {
    mocks.claimAttempt
      .mockResolvedValueOnce({
        attempt: 2,
        jobId: 'trigger-run-failed',
        run,
        shouldEnqueue: false,
      })
      .mockResolvedValueOnce({
        attempt: 3,
        jobId: null,
        run: { ...run, resendSyncJobId: null },
        shouldEnqueue: true,
      })
    mocks.queueGetJob.mockResolvedValue({
      id: 'trigger-run-failed',
      status: 'failed',
      error: 'worker stopped',
    })
    mocks.queueEnqueue.mockResolvedValue('trigger-run-retry')
    mocks.setJob.mockResolvedValue({ ...run, resendSyncJobId: 'trigger-run-retry' })

    const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 3, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_3' })
    )
    expect(result.jobId).toBe('trigger-run-retry')
  })

  it('starts a new attempt when a completed job did not finalize the newsletter run', async () => {
    mocks.claimAttempt
      .mockResolvedValueOnce({
        attempt: 2,
        jobId: 'trigger-run-completed',
        run,
        shouldEnqueue: false,
      })
      .mockResolvedValueOnce({
        attempt: 3,
        jobId: null,
        run: { ...run, resendSyncJobId: null },
        shouldEnqueue: true,
      })
    mocks.queueGetJob.mockResolvedValue({
      id: 'trigger-run-completed',
      status: 'completed',
    })
    mocks.queueEnqueue.mockResolvedValue('trigger-run-retry')
    mocks.setJob.mockResolvedValue({ ...run, resendSyncJobId: 'trigger-run-retry' })

    const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 3, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_3' })
    )
    expect(result.jobId).toBe('trigger-run-retry')
  })

  it.each([
    ['completed', { id: 'trigger-run-existing', status: 'completed' }],
    ['processing', { id: 'trigger-run-existing', status: 'processing' }],
    ['missing', null],
  ])(
    'keeps the stored job when the newsletter run is pushed and the provider job is %s',
    async (_providerState, providerJob) => {
      const pushedRun = { ...run, status: 'pushed' }
      mocks.claimAttempt.mockResolvedValue({
        attempt: 2,
        jobId: 'trigger-run-existing',
        run: pushedRun,
        shouldEnqueue: false,
      })
      mocks.queueGetJob.mockResolvedValue(providerJob)

      const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

      expect(mocks.queueGetJob).not.toHaveBeenCalled()
      expect(mocks.markFailed).not.toHaveBeenCalled()
      expect(mocks.queueEnqueue).not.toHaveBeenCalled()
      expect(result).toEqual({ run: pushedRun, jobId: 'trigger-run-existing' })
    }
  )

  it('re-enqueues when a stored Trigger.dev run no longer exists', async () => {
    mocks.claimAttempt
      .mockResolvedValueOnce({
        attempt: 2,
        jobId: 'trigger-run-missing',
        run,
        shouldEnqueue: false,
      })
      .mockResolvedValueOnce({
        attempt: 3,
        jobId: null,
        run,
        shouldEnqueue: true,
      })
    mocks.queueGetJob.mockResolvedValue(null)

    await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 3, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_3' })
    )
  })

  it('cancels and replaces an active Trigger.dev run when an admin resumes it', async () => {
    mocks.claimAttempt
      .mockResolvedValueOnce({
        attempt: 2,
        jobId: 'trigger-run-active',
        run,
        shouldEnqueue: false,
      })
      .mockResolvedValueOnce({
        attempt: 3,
        jobId: null,
        run,
        shouldEnqueue: true,
      })
    mocks.queueGetJob.mockResolvedValue({
      id: 'trigger-run-active',
      status: 'processing',
    })

    const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.queueCancel).toHaveBeenCalledWith('trigger-run-active')
    expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'newsletter-resend-sync',
      { runId: 'run-1', attempt: 3, requestedById: 'admin-1' },
      expect.objectContaining({ jobId: 'newsletter_resend_run-1_3' })
    )
    expect(result.jobId).toBe('trigger-run-123')
  })

  it('resets failed recipients before a task retry', async () => {
    mocks.requireAttempt.mockResolvedValue(run)
    mocks.getExcludedEmails.mockResolvedValue(new Set())
    mocks.getPendingRecipients.mockResolvedValue([])
    mocks.countByStatus.mockResolvedValue({})

    await runNewsletterResendSync({
      runId: 'run-1',
      attempt: 2,
      requestedById: 'admin-1',
    })

    expect(mocks.resetFailedRecipients).toHaveBeenCalledWith('run-1', 2)
    expect(mocks.markPushed).toHaveBeenCalledWith('run-1', 2, 'segment-1', 'Segment 1')
  })

  it('does not mark the run pushed while recipients remain pending', async () => {
    mocks.requireAttempt.mockResolvedValue(run)
    mocks.getExcludedEmails.mockResolvedValue(new Set())
    mocks.getPendingRecipients.mockResolvedValue([])
    mocks.countByStatus.mockResolvedValue({ pending: 1 })

    await expect(
      runNewsletterResendSync({
        runId: 'run-1',
        attempt: 2,
        requestedById: 'admin-1',
      })
    ).rejects.toThrow('1 remain pending')

    expect(mocks.markPushed).not.toHaveBeenCalled()
    expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
  })

  it('treats same-attempt worker re-entry after success as a no-op', async () => {
    mocks.requireAttempt.mockResolvedValue({ ...run, status: 'pushed' })

    await runNewsletterResendSync({
      runId: 'run-1',
      attempt: 2,
      requestedById: 'admin-1',
    })

    expect(mocks.resetFailedRecipients).not.toHaveBeenCalled()
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('does not fail the newsletter attempt when its database claim is aborted', async () => {
    const controller = new AbortController()
    controller.abort('claim lost')

    await expect(
      runNewsletterResendSync(
        {
          runId: 'run-1',
          attempt: 2,
          requestedById: 'admin-1',
        },
        controller.signal
      )
    ).rejects.toBe('claim lost')

    expect(mocks.requireAttempt).not.toHaveBeenCalled()
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('does not persist a segment after ownership is lost during segment creation', async () => {
    const controller = new AbortController()
    mocks.requireAttempt.mockResolvedValue({
      ...run,
      resendSegmentId: null,
      resendSegmentName: null,
    })
    mocks.createSegment.mockImplementationOnce(async () => {
      controller.abort('claim lost')
      return { id: 'segment-new', name: 'Segment new' }
    })

    await expect(
      runNewsletterResendSync(
        {
          runId: 'run-1',
          attempt: 2,
          requestedById: 'admin-1',
        },
        controller.signal
      )
    ).rejects.toBe('claim lost')

    expect(mocks.setSegment).not.toHaveBeenCalled()
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('does not mark a run pushed after ownership is lost during status aggregation', async () => {
    const controller = new AbortController()
    mocks.requireAttempt.mockResolvedValue(run)
    mocks.getExcludedEmails.mockResolvedValue(new Set())
    mocks.getPendingRecipients.mockResolvedValue([])
    mocks.countByStatus.mockImplementationOnce(async () => {
      controller.abort('claim lost')
      return {}
    })

    await expect(
      runNewsletterResendSync(
        {
          runId: 'run-1',
          attempt: 2,
          requestedById: 'admin-1',
        },
        controller.signal
      )
    ).rejects.toBe('claim lost')

    expect(mocks.markPushed).not.toHaveBeenCalled()
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })
})
