import { getJobQueue } from '@/lib/core/async-jobs'
import {
  SLACK_SEARCH_CONCURRENCY,
  SLACK_SEARCH_MAX_DURATION_SECONDS,
} from '@/lib/slack-search/constants'
import type { SlackSearchJob } from '@/lib/slack-search/types'

export async function enqueueSlackSearch(job: SlackSearchJob) {
  return (await getJobQueue()).enqueue('slack-search', job, {
    jobId: `slack-search:${job.installationId}:${job.message.eventId}`,
    maxAttempts: 1,
    maxDurationSeconds: SLACK_SEARCH_MAX_DURATION_SECONDS,
    concurrencyKey: job.installationId,
    concurrencyLimit: SLACK_SEARCH_CONCURRENCY,
    async runner(payload, signal) {
      const { handleSlackSearchMessage } = await import(
        '@/lib/slack-search/handlers/search-message'
      )
      await handleSlackSearchMessage(payload, signal)
    },
  })
}
