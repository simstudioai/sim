import { generateId } from '@sim/utils/id'
import { getInlineJobQueue } from '@/lib/core/async-jobs'
import {
  SLACK_SEARCH_CONCURRENCY,
  SLACK_SEARCH_MAX_DURATION_SECONDS,
} from '@/lib/slack-search/constants'

/** Runs durable turns in the app process; repeated wakes cannot repeat a claimed execution. */
export async function enqueueSlackSearch(input: { turnId: string; installationId: string }) {
  return (await getInlineJobQueue()).enqueue(
    'slack-search',
    { turnId: input.turnId },
    {
      jobId: `slack-search:${input.turnId}:${generateId()}`,
      maxAttempts: 1,
      maxDurationSeconds: SLACK_SEARCH_MAX_DURATION_SECONDS + 30,
      concurrencyKey: input.installationId,
      concurrencyLimit: SLACK_SEARCH_CONCURRENCY,
      async runner(payload, signal) {
        const { handleSlackSearchMessage } = await import(
          '@/lib/slack-search/handlers/search-message'
        )
        await handleSlackSearchMessage(payload, signal)
      },
    }
  )
}
