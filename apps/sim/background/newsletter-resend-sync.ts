import { task } from '@trigger.dev/sdk'
import {
  NEWSLETTER_RESEND_SYNC_CONCURRENCY_LIMIT,
  NEWSLETTER_RESEND_SYNC_MAX_ATTEMPTS,
  type NewsletterResendSyncPayload,
  runNewsletterResendSync,
} from '@/lib/newsletters/push-resend'

export const newsletterResendSyncTask = task({
  id: 'newsletter-resend-sync',
  machine: 'small-1x',
  retry: {
    maxAttempts: NEWSLETTER_RESEND_SYNC_MAX_ATTEMPTS,
  },
  queue: {
    concurrencyLimit: NEWSLETTER_RESEND_SYNC_CONCURRENCY_LIMIT,
  },
  run: async (payload: NewsletterResendSyncPayload) => runNewsletterResendSync(payload),
})
