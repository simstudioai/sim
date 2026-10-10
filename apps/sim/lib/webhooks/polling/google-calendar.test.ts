import { createLogger } from '@sim/logger'
import { createWorkflowRecord } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  webhooksProcessorMock,
  webhooksProcessorMockFns,
} from '@sim/testing/mocks/webhooks-processor.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpdateConfig, mockMarkFailed } = vi.hoisted(() => ({
  mockUpdateConfig: vi.fn(),
  mockMarkFailed: vi.fn(),
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  pollingIdempotency: {
    executeWithIdempotency: vi.fn(
      async (_provider: string, _key: string, execute: () => Promise<unknown>) => execute()
    ),
  },
}))

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/webhooks/polling/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webhooks/polling/utils')>()),
  resolveOAuthCredential: vi.fn().mockResolvedValue('access-token'),
  markWebhookSuccess: vi.fn(),
  markWebhookFailed: mockMarkFailed,
  updateWebhookProviderConfig: mockUpdateConfig,
}))

import { ADMISSION_REJECTION_CODE } from '@/lib/core/admission/rejection'
import { googleCalendarPollingHandler } from '@/lib/webhooks/polling/google-calendar'
import type { PollWebhookContext, WebhookRecord } from '@/lib/webhooks/polling/types'

const mockProcessEvent = webhooksProcessorMockFns.mockProcessPolledWebhookEvent

function context(): PollWebhookContext {
  const webhookData: WebhookRecord = {
    id: 'calendar-webhook',
    workflowId: 'calendar-listener',
    deploymentVersionId: null,
    registrationStatus: null,
    registrationGeneration: null,
    configFingerprint: null,
    preparedAt: null,
    blockId: null,
    path: 'calendar-listener',
    routingKey: null,
    provider: 'google-calendar',
    providerConfig: {
      calendarId: 'primary',
      lastCheckedTimestamp: '2026-10-09T11:00:00.000Z',
    },
    isActive: true,
    failedCount: 0,
    lastFailedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-09T11:00:00.000Z'),
  }
  return {
    webhookData,
    workflowData: createWorkflowRecord({
      id: 'calendar-listener',
    }) as PollWebhookContext['workflowData'],
    requestId: 'calendar-request',
    logger: createLogger('GoogleCalendarTest'),
  }
}

describe('Google Calendar polling when execution admission refuses events', () => {
  beforeEach(() => {
    const events = ['event-1', 'event-2'].map((id) => ({
      id,
      status: 'confirmed',
      created: '2026-10-09T11:30:00.000Z',
      updated: '2026-10-09T11:30:00.000Z',
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: events }, 200)))
    mockProcessEvent.mockResolvedValue({
      success: false,
      statusCode: 402,
      error: 'Usage limit exceeded',
      code: ADMISSION_REJECTION_CODE.USAGE_LIMIT_EXCEEDED,
      retryable: false,
    })
  })

  it('stops the batch without advancing its cursor or counting a failure', async () => {
    expect(await googleCalendarPollingHandler.pollWebhook(context())).toBe('skipped')

    expect(mockProcessEvent).toHaveBeenCalledOnce()
    const cursorUpdates = mockUpdateConfig.mock.calls.filter(
      ([, update]) => 'lastCheckedTimestamp' in (update as Record<string, unknown>)
    )
    expect(cursorUpdates).toEqual([])
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })
})
