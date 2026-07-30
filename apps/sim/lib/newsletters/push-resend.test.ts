/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimAttempt: vi.fn(),
  countByStatus: vi.fn(),
  createContact: vi.fn(),
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
  createOrSegmentNewsletterContact: mocks.createContact,
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

import { pushNewsletterRunResponseSchema } from '@/lib/api/contracts/newsletters'
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
    mocks.setSegment.mockResolvedValue(run)
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

  it('does not enqueue a pushed run without a stored job id', async () => {
    const pushedRun = { ...run, status: 'pushed' }
    mocks.claimAttempt.mockResolvedValue({
      attempt: 2,
      jobId: null,
      run: pushedRun,
      shouldEnqueue: false,
    })

    const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

    expect(mocks.getJobQueue).not.toHaveBeenCalled()
    expect(mocks.queueEnqueue).not.toHaveBeenCalled()
    expect(result).toEqual({ run: pushedRun, jobId: null })
    expect(pushNewsletterRunResponseSchema.shape.jobId.parse(result.jobId)).toBeNull()
  })

  it.each([
    ['completed', { id: 'trigger-run-existing', status: 'completed' }],
    ['failed', { id: 'trigger-run-existing', status: 'failed', error: 'worker failed' }],
    ['processing', { id: 'trigger-run-existing', status: 'processing' }],
  ])(
    'does not enqueue when reconciliation of a %s job refreshes to pushed',
    async (_providerState, providerJob) => {
      const pushedRun = { ...run, status: 'pushed' }
      mocks.claimAttempt
        .mockResolvedValueOnce({
          attempt: 2,
          jobId: 'trigger-run-existing',
          run,
          shouldEnqueue: false,
        })
        .mockResolvedValueOnce({
          attempt: 2,
          jobId: null,
          run: pushedRun,
          shouldEnqueue: false,
        })
      mocks.queueGetJob.mockResolvedValue(providerJob)

      const result = await enqueueNewsletterResendSync('run-1', 'admin-1')

      expect(mocks.markFailed).toHaveBeenCalledWith('run-1', 2, expect.any(Error))
      expect(mocks.queueEnqueue).not.toHaveBeenCalled()
      expect(mocks.setJob).not.toHaveBeenCalled()
      expect(result).toEqual({ run: pushedRun, jobId: null })
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

  it('stops when the authoritative post-reset read is already pushed', async () => {
    mocks.requireAttempt
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, status: 'pushed' })

    await runNewsletterResendSync({
      runId: 'run-1',
      attempt: 2,
      requestedById: 'admin-1',
    })

    expect(mocks.createSegment).not.toHaveBeenCalled()
    expect(mocks.setSegment).not.toHaveBeenCalled()
    expect(mocks.ensureProperties).not.toHaveBeenCalled()
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })

  it('uses the segment from the authoritative post-reset read', async () => {
    const staleRun = {
      ...run,
      resendSegmentId: null,
      resendSegmentName: null,
    }
    const currentRun = {
      ...run,
      resendSegmentId: 'segment-current',
      resendSegmentName: 'Current segment',
    }
    mocks.requireAttempt.mockResolvedValueOnce(staleRun).mockResolvedValueOnce(currentRun)
    mocks.setSegment.mockResolvedValue(currentRun)
    mocks.getExcludedEmails.mockResolvedValue(new Set())
    mocks.getPendingRecipients.mockResolvedValue([])
    mocks.countByStatus.mockResolvedValue({})

    await runNewsletterResendSync({
      runId: 'run-1',
      attempt: 2,
      requestedById: 'admin-1',
    })

    expect(mocks.createSegment).not.toHaveBeenCalled()
    expect(mocks.setSegment).toHaveBeenCalledWith('run-1', 2, 'segment-current', 'Current segment')
    expect(mocks.markPushed).toHaveBeenCalledWith('run-1', 2, 'segment-current', 'Current segment')
  })

  it('stops when another worker pushes while a segment is being created', async () => {
    const runWithoutSegment = {
      ...run,
      resendSegmentId: null,
      resendSegmentName: null,
    }
    mocks.requireAttempt.mockResolvedValue(runWithoutSegment)
    mocks.createSegment.mockResolvedValue({ id: 'segment-new', name: 'New segment' })
    mocks.setSegment.mockResolvedValue({
      ...run,
      status: 'pushed',
      resendSegmentId: 'segment-winner',
      resendSegmentName: 'Winner segment',
    })

    await runNewsletterResendSync({
      runId: 'run-1',
      attempt: 2,
      requestedById: 'admin-1',
    })

    expect(mocks.setSegment).toHaveBeenCalledWith('run-1', 2, 'segment-new', 'New segment')
    expect(mocks.ensureProperties).not.toHaveBeenCalled()
    expect(mocks.markPushed).not.toHaveBeenCalled()
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

  it('forwards cancellation to every Resend operation', async () => {
    const controller = new AbortController()
    const recipient = {
      currentUserEligible: true,
      email: 'user@example.com',
      name: 'Ada Lovelace',
      simUnsubscribed: false,
      snapshotVersion: 1,
      userId: 'user-1',
    }
    mocks.requireAttempt.mockResolvedValue({
      ...run,
      resendSegmentId: null,
      resendSegmentName: null,
    })
    mocks.createSegment.mockResolvedValue({ id: 'segment-new', name: 'Segment new' })
    mocks.getExcludedEmails.mockResolvedValue(new Set())
    mocks.getPendingRecipients.mockResolvedValueOnce([recipient]).mockResolvedValueOnce([])
    mocks.createContact.mockResolvedValue({ status: 'created', contactId: 'contact-1' })
    mocks.countByStatus.mockResolvedValue({})

    await runNewsletterResendSync(
      {
        runId: 'run-1',
        attempt: 2,
        requestedById: 'admin-1',
      },
      controller.signal
    )

    expect(mocks.createSegment).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    })
    expect(mocks.ensureProperties).toHaveBeenCalledWith({ signal: controller.signal })
    expect(mocks.getExcludedEmails).toHaveBeenCalledWith({ signal: controller.signal })
    expect(mocks.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
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
