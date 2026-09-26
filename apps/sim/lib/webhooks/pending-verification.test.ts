import { redisConfigMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingWebhookVerification,
  getPendingWebhookVerification,
  matchesPendingWebhookVerificationProbe,
  PendingWebhookVerificationTracker,
  registerPendingWebhookVerification,
} from '@/lib/webhooks/pending-verification'

describe('pending webhook verification', () => {
  beforeEach(() => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
  })

  afterEach(async () => {
    await clearPendingWebhookVerification('grain-path-1')
    await clearPendingWebhookVerification('grain-path-2')
    await clearPendingWebhookVerification('grain-path-3')
    await clearPendingWebhookVerification('grain-path-4')
  })

  it('matches Grain verification probe shapes only for registered paths', async () => {
    await registerPendingWebhookVerification({
      path: 'grain-path-2',
      provider: 'grain',
    })

    const entry = await getPendingWebhookVerification('grain-path-2')

    expect(entry).not.toBeNull()
    expect(
      matchesPendingWebhookVerificationProbe(entry!, {
        method: 'POST',
        body: {},
      })
    ).toBe(true)
    expect(
      matchesPendingWebhookVerificationProbe(entry!, {
        method: 'POST',
        body: { type: 'recording_added' },
      })
    ).toBe(false)
  })

  it('does not register generic pending verification unless verifyTestEvents is enabled', async () => {
    await registerPendingWebhookVerification({
      path: 'grain-path-3',
      provider: 'generic',
      metadata: { verifyTestEvents: false },
    })

    expect(await getPendingWebhookVerification('grain-path-3')).toBeNull()
  })

  it('clears tracked pending verifications after a successful lifecycle', async () => {
    const tracker = new PendingWebhookVerificationTracker()

    await tracker.register({
      path: 'grain-path-3',
      provider: 'grain',
    })

    expect(await getPendingWebhookVerification('grain-path-3')).not.toBeNull()

    await tracker.clearAll()

    expect(await getPendingWebhookVerification('grain-path-3')).toBeNull()
  })
})
