import { createLogger } from '@sim/logger'
import { createWorkflowRecord } from '@sim/testing/factories/permission.factory'
import { idempotencyServiceMock } from '@sim/testing/mocks/idempotency-service.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import {
  webhooksPollingUtilsMock,
  webhooksPollingUtilsMockFns,
} from '@sim/testing/mocks/webhooks-polling-utils.mock'
import {
  webhooksProcessorMock,
  webhooksProcessorMockFns,
} from '@sim/testing/mocks/webhooks-processor.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
const mockFetch = inputValidationMockFns.mockSecureFetchWithPinnedIP
const mockValidateUrl = inputValidationMockFns.mockValidateUrlWithDNS

vi.mock('@/lib/core/idempotency/service', () => idempotencyServiceMock)

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/webhooks/polling/utils', () => webhooksPollingUtilsMock)

import { ADMISSION_REJECTION_CODE } from '@/lib/core/admission/rejection'
import { rssPollingHandler } from '@/lib/webhooks/polling/rss'
import type { PollWebhookContext, WebhookRecord } from '@/lib/webhooks/polling/types'
import { PollFetchError } from '@/lib/webhooks/polling/utils'

const mockProcessEvent = webhooksProcessorMockFns.mockProcessPolledWebhookEvent
const {
  mockUpdateWebhookProviderConfig: mockUpdateConfig,
  mockMarkWebhookFailed: mockMarkFailed,
  mockRecordPollSourceFailure,
} = webhooksPollingUtilsMockFns

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

describe('RSS polling against refusals and rate limits', () => {
  beforeEach(() => {
    mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockUpdateConfig.mockResolvedValue(undefined)
  })

  it('leaves an item unseen and uncounted when execution admission refuses it', async () => {
    mockFetch.mockResolvedValue(feed('Fri, 11 Sep 2026 21:25:32 GMT'))
    mockProcessEvent.mockResolvedValue({
      success: false,
      statusCode: 402,
      error: 'Usage limit exceeded',
      code: ADMISSION_REJECTION_CODE.USAGE_LIMIT_EXCEEDED,
      retryable: false,
    })

    expect(await rssPollingHandler.pollWebhook(context())).toBe('skipped')

    const recordedGuids = mockUpdateConfig.mock.calls.flatMap(
      ([, update]) => (update as { lastSeenGuids?: string[] }).lastSeenGuids ?? []
    )
    expect(recordedGuids).not.toContain(GUID)
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('records a rate-limited fetch as one source failure carrying its status', async () => {
    mockFetch.mockResolvedValue(
      new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '12' },
      })
    )

    expect(await rssPollingHandler.pollWebhook(context())).toBe('failure')

    expect(mockRecordPollSourceFailure).toHaveBeenCalledOnce()
    const [, , error] = mockRecordPollSourceFailure.mock.calls[0]
    expect(error).toBeInstanceOf(PollFetchError)
    expect(error).toMatchObject({ status: 429 })
  })
})
