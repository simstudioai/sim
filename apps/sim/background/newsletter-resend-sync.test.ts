/**
 * @vitest-environment node
 */
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runSync: vi.fn(),
  task: vi.fn((definition) => definition),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: mocks.task,
}))

vi.mock('@/lib/newsletters/push-resend', () => ({
  NEWSLETTER_RESEND_SYNC_CONCURRENCY_LIMIT: 1,
  NEWSLETTER_RESEND_SYNC_MAX_ATTEMPTS: 3,
  runNewsletterResendSync: mocks.runSync,
}))

import type { NewsletterResendSyncPayload } from '@/lib/newsletters/push-resend'
import { newsletterResendSyncTask } from '@/background/newsletter-resend-sync'

interface NewsletterTaskDefinition {
  run: (payload: NewsletterResendSyncPayload, context: { signal: AbortSignal }) => Promise<unknown>
}

it('forwards the Trigger.dev cancellation signal to the sync service', async () => {
  const payload = {
    runId: 'run-1',
    attempt: 1,
    requestedById: 'admin-1',
  }
  const controller = new AbortController()
  const definition = newsletterResendSyncTask as unknown as NewsletterTaskDefinition

  await definition.run(payload, { signal: controller.signal })

  expect(mocks.runSync).toHaveBeenCalledWith(payload, controller.signal)
})
