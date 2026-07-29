import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import {
  getAsyncBackendType,
  getJobQueue,
  isAsyncJobEnqueueError,
  JOB_STATUS,
} from '@/lib/core/async-jobs'
import {
  createNewsletterSegment,
  createOrSegmentNewsletterContact,
  ensureNewsletterContactProperties,
  getResendExcludedEmails,
} from '@/lib/newsletters/resend'
import {
  claimNewsletterRunResendAttempt,
  countNewsletterRecipientsByStatus,
  getPendingNewsletterRecipients,
  markNewsletterRunPushed,
  markNewsletterRunPushFailed,
  requireNewsletterRunAttempt,
  resetFailedNewsletterRecipients,
  setNewsletterRunResendJob,
  setNewsletterRunResendSegment,
  updateRecipientSyncStatus,
} from '@/lib/newsletters/runs'

const logger = createLogger('NewsletterResendSync')
const NEWSLETTER_RESEND_BATCH_SIZE = 25
const NEWSLETTER_RESEND_CONCURRENCY = 5
export const NEWSLETTER_RESEND_SYNC_CONCURRENCY_LIMIT = 1
export const NEWSLETTER_RESEND_SYNC_MAX_ATTEMPTS = 3

const newsletterResendSyncPayloadSchema = z.object({
  runId: z.string().min(1),
  attempt: z.number().int().positive(),
  requestedById: z.string().min(1),
})

export type NewsletterResendSyncPayload = z.output<typeof newsletterResendSyncPayloadSchema>

function segmentNameForRun(runName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `Sim Newsletter - ${runName} - ${date} - ${generateShortId(8)}`
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
) {
  for (let index = 0; index < items.length; index += limit) {
    signal?.throwIfAborted()
    await Promise.all(items.slice(index, index + limit).map(worker))
  }
}

export async function runNewsletterResendSync(
  payload: NewsletterResendSyncPayload,
  signal?: AbortSignal
) {
  const { runId, attempt } = newsletterResendSyncPayloadSchema.parse(payload)

  try {
    signal?.throwIfAborted()
    const run = await requireNewsletterRunAttempt(runId, attempt)
    if (run.status === 'pushed') return
    if (run.status !== 'finalized' && run.status !== 'pushing' && run.status !== 'failed') {
      throw new Error('Newsletter run must be finalized before pushing to Resend')
    }
    await resetFailedNewsletterRecipients(runId)

    signal?.throwIfAborted()
    const segment =
      run.resendSegmentId && run.resendSegmentName
        ? { id: run.resendSegmentId, name: run.resendSegmentName }
        : await createNewsletterSegment(segmentNameForRun(run.name))

    signal?.throwIfAborted()
    if (!run.resendSegmentId) {
      await setNewsletterRunResendSegment(runId, attempt, segment.id, segment.name)
    }

    signal?.throwIfAborted()
    await ensureNewsletterContactProperties()
    signal?.throwIfAborted()
    const suppressedEmails = await getResendExcludedEmails()
    let processed = 0

    while (true) {
      signal?.throwIfAborted()
      const recipients = await getPendingNewsletterRecipients(runId, NEWSLETTER_RESEND_BATCH_SIZE)
      if (recipients.length === 0) break

      await runWithConcurrency(
        recipients,
        NEWSLETTER_RESEND_CONCURRENCY,
        async (recipient) => {
          signal?.throwIfAborted()
          if (
            !recipient.currentUserEligible ||
            recipient.simUnsubscribed ||
            suppressedEmails.has(recipient.email.toLowerCase())
          ) {
            await updateRecipientSyncStatus(
              runId,
              recipient.snapshotVersion,
              recipient.email,
              'excluded'
            )
            return
          }

          try {
            const result = await createOrSegmentNewsletterContact({
              email: recipient.email,
              name: recipient.name,
              userId: recipient.userId,
              runId,
              segmentId: segment.id,
            })
            signal?.throwIfAborted()
            await updateRecipientSyncStatus(
              runId,
              recipient.snapshotVersion,
              recipient.email,
              result.status,
              {
                contactId: result.contactId,
              }
            )
          } catch (error) {
            signal?.throwIfAborted()
            await updateRecipientSyncStatus(
              runId,
              recipient.snapshotVersion,
              recipient.email,
              'failed',
              {
                error: getErrorMessage(error, 'Failed to sync recipient'),
              }
            )
          }
        },
        signal
      )

      processed += recipients.length
      logger.info('Processed newsletter Resend recipient batch', {
        runId,
        processed,
        segmentId: segment.id,
      })
    }

    signal?.throwIfAborted()
    const statusCounts = await countNewsletterRecipientsByStatus(runId)
    signal?.throwIfAborted()
    const failed = statusCounts.failed ?? 0
    if (failed > 0) {
      throw new Error(`${failed} recipients failed to sync to Resend`)
    }

    signal?.throwIfAborted()
    await markNewsletterRunPushed(runId, attempt, segment.id, segment.name)
  } catch (error) {
    if (signal?.aborted) throw error
    await markNewsletterRunPushFailed(runId, attempt, error)
    throw error
  }
}

export async function enqueueNewsletterResendSync(runId: string, requestedById: string) {
  const claim = await claimNewsletterRunResendAttempt(runId)
  const queue = await getJobQueue()
  if (!claim.shouldEnqueue && claim.jobId) {
    if (getAsyncBackendType() !== 'database') {
      return { run: claim.run, jobId: claim.jobId }
    }

    const persistedJob = await queue.getJob(claim.jobId)
    if (persistedJob?.status === JOB_STATUS.COMPLETED) {
      return { run: claim.run, jobId: claim.jobId }
    }
    if (persistedJob?.status === JOB_STATUS.FAILED) {
      const error = new Error(persistedJob.error ?? 'Newsletter sync database job failed')
      await markNewsletterRunPushFailed(runId, claim.attempt, error)
      throw error
    }
  }

  const enqueueKey = claim.jobId ?? `newsletter_resend_${runId}_${claim.attempt}`
  let jobId: string
  try {
    await resetFailedNewsletterRecipients(runId)
    jobId = await queue.enqueue<NewsletterResendSyncPayload>(
      'newsletter-resend-sync',
      { runId, attempt: claim.attempt, requestedById },
      {
        jobId: enqueueKey,
        metadata: { userId: requestedById, newsletterRunId: runId },
        concurrencyKey: 'newsletter-resend-sync',
        concurrencyLimit: NEWSLETTER_RESEND_SYNC_CONCURRENCY_LIMIT,
        maxAttempts: NEWSLETTER_RESEND_SYNC_MAX_ATTEMPTS,
        runner: async (payload, signal) =>
          runNewsletterResendSync(payload as NewsletterResendSyncPayload, signal),
      }
    )
  } catch (error) {
    if (!isAsyncJobEnqueueError(error) || error.acceptance === 'rejected') {
      await markNewsletterRunPushFailed(runId, claim.attempt, error)
    }
    throw error
  }

  let updatedRun: Awaited<ReturnType<typeof setNewsletterRunResendJob>>
  try {
    updatedRun = await setNewsletterRunResendJob(runId, claim.attempt, jobId)
  } catch (error) {
    throw new Error(
      `Newsletter sync job was accepted but tracking persistence failed: ${getErrorMessage(error)}`,
      { cause: error }
    )
  }
  return { run: updatedRun, jobId }
}
