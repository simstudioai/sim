import { task } from '@trigger.dev/sdk'
import {
  SLACK_SEARCH_CONCURRENCY,
  SLACK_SEARCH_MAX_DURATION_SECONDS,
} from '@/lib/slack-search/constants'
import { handleSlackSearchMessage } from '@/lib/slack-search/handlers/search-message'

export const slackSearchTask = task({
  id: 'slack-search',
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: SLACK_SEARCH_CONCURRENCY },
  maxDuration: SLACK_SEARCH_MAX_DURATION_SECONDS + 30,
  run: (payload: unknown) => handleSlackSearchMessage(payload),
})
