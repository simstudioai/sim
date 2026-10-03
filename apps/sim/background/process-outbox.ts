import { task } from '@trigger.dev/sdk'
import {
  OUTBOX_PROCESSOR_CONCURRENCY,
  OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
} from '@/lib/core/outbox/constants'
import { runOutboxProcessor } from '@/lib/core/outbox/processor'

/** Runs bounded outbox delivery beyond the cron caller's HTTP deadline. */
export const processOutboxTask = task({
  id: 'process-outbox',
  machine: 'medium-2x',
  maxDuration: OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
  /** Per-event retries live in the outbox; a later cron tick recovers interrupted work. */
  retry: { maxAttempts: 1 },
  queue: {
    name: 'process-outbox',
    concurrencyLimit: OUTBOX_PROCESSOR_CONCURRENCY,
  },
  run: () => runOutboxProcessor(),
})
