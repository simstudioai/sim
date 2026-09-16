/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { createWorkflowRecord } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockValidateUrl, mockProcessEvent, mockUpdateConfig } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
  mockProcessEvent: vi.fn(),
  mockUpdateConfig: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  pollingIdempotency: {
    executeWithIdempotency: vi.fn(
      async (_provider: string, _key: string, execute: () => Promise<unknown>) => execute()
    ),
  },
}))

vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: mockProcessEvent,
}))

vi.mock('@/lib/webhooks/polling/utils', () => ({
  markWebhookSuccess: vi.fn(),
  markWebhookFailed: vi.fn(),
  updateWebhookProviderConfig: mockUpdateConfig,
}))

import { rssPollingHandler } from '@/lib/webhooks/polling/rss'
import type { PollWebhookContext, WebhookRecord } from '@/lib/webhooks/polling/types'

const SUBSCRIBED_AT = new Date('2026-08-27T18:36:16.000Z')
const LAST_CHECKED_AT = '2026-09-11T23:26:27.000Z'
const GUID = 'https://example.com/news/late-item'

function context(lastSeenGuids: string[] = []): PollWebhookContext {
  const webhookData: WebhookRecord = {
    id: 'rss-webhook',
    workflowId: 'rss-listener',
    deploymentVersionId: null,
    registrationStatus: null,
    registrationGeneration: null,
    configFingerprint: null,
    preparedAt: null,
    blockId: null,
    path: 'rss-listener',
    routingKey: null,
    provider: 'rss',
    providerConfig: {
      feedUrl: 'https://example.com/feed.xml',
      lastCheckedTimestamp: LAST_CHECKED_AT,
      lastSeenGuids,
    },
    isActive: true,
    failedCount: 0,
    lastFailedAt: null,
    archivedAt: null,
    createdAt: SUBSCRIBED_AT,
    updatedAt: new Date(LAST_CHECKED_AT),
  }
  return {
    webhookData,
    workflowData: createWorkflowRecord({
      id: 'rss-listener',
    }) as PollWebhookContext['workflowData'],
    requestId: 'rss-request',
    logger: createLogger('RssTest'),
  }
}

function feed(pubDate: string) {
  return new Response(
    `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Canary fixture</title><link>https://example.com</link><description>RSS fixture</description>
      <item><title>Late item</title><guid>${GUID}</guid><pubDate>${pubDate}</pubDate></item>
    </channel></rss>`,
    { headers: { 'Content-Type': 'application/rss+xml' } }
  )
}

describe('RSS delivery across delayed feed updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockProcessEvent.mockResolvedValue({ success: true })
    mockUpdateConfig.mockResolvedValue(undefined)
  })

  it('delivers an unseen item published before the last poll but after subscription', async () => {
    mockFetch.mockResolvedValue(feed('Fri, 11 Sep 2026 21:25:32 GMT'))

    expect(await rssPollingHandler.pollWebhook(context())).toBe('success')
    expect(mockProcessEvent).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ item: expect.objectContaining({ guid: GUID }) }),
      'rss-request'
    )
    expect(mockUpdateConfig).toHaveBeenCalledWith(
      'rss-webhook',
      expect.objectContaining({ lastSeenGuids: [GUID] }),
      expect.anything()
    )
  })

  it('does not redeliver a known GUID when its publication date changes', async () => {
    mockFetch.mockResolvedValue(feed('Fri, 11 Sep 2026 23:28:00 GMT'))

    expect(await rssPollingHandler.pollWebhook(context([GUID]))).toBe('success')
    expect(mockProcessEvent).not.toHaveBeenCalled()
  })

  it('does not backfill items published before the subscription existed', async () => {
    mockFetch.mockResolvedValue(feed('Thu, 27 Aug 2026 18:30:00 GMT'))

    expect(await rssPollingHandler.pollWebhook(context())).toBe('success')
    expect(mockProcessEvent).not.toHaveBeenCalled()
  })
})
