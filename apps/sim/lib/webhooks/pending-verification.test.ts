/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  clearPendingWebhookVerification,
  getPendingWebhookVerification,
  matchesPendingWebhookVerificationProbe,
  PendingWebhookVerificationTracker,
  registerPendingWebhookVerification,
} from '@/lib/webhooks/pending-verification'

describe('pending webhook verification', () => {
  afterEach(async () => {
    await clearPendingWebhookVerification('grain-path-1')
    await clearPendingWebhookVerification('grain-path-2')
    await clearPendingWebhookVerification('grain-path-3')
    await clearPendingWebhookVerification('grain-path-4')
  })

  it('stores and retrieves pending Grain verification entries', async () => {
    await registerPendingWebhookVerification({
      path: 'grain-path-1',
      provider: 'grain',
      workflowId: 'workflow-1',
      blockId: 'block-1',
    })

    const entry = await getPendingWebhookVerification('grain-path-1')

    expect(entry).toMatchObject({
      path: 'grain-path-1',
      provider: 'grain',
      workflowId: 'workflow-1',
      blockId: 'block-1',
    })
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

  it('registers generic pending verification when verifyTestEvents is enabled', async () => {
    await registerPendingWebhookVerification({
      path: 'grain-path-3',
      provider: 'generic',
      metadata: { verifyTestEvents: true },
    })

    const entry = await getPendingWebhookVerification('grain-path-3')

    expect(entry).toMatchObject({
      path: 'grain-path-3',
      provider: 'generic',
      metadata: { verifyTestEvents: true },
    })
    expect(
      matchesPendingWebhookVerificationProbe(entry!, {
        method: 'POST',
        body: {},
      })
    ).toBe(true)
    expect(
      matchesPendingWebhookVerificationProbe(entry!, {
        method: 'POST',
        body: { message: 'real event' },
      })
    ).toBe(false)
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

  it('clears tracked pending verifications after a failed lifecycle', async () => {
    const tracker = new PendingWebhookVerificationTracker()

    await tracker.register({
      path: 'grain-path-4',
      provider: 'grain',
    })

    expect(await getPendingWebhookVerification('grain-path-4')).not.toBeNull()

    await tracker.clear('grain-path-4')

    expect(await getPendingWebhookVerification('grain-path-4')).toBeNull()
  })
})
