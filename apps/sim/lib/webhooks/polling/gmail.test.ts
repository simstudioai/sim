import { createLogger } from '@sim/logger'
import { jsonResponse } from '@sim/testing/helpers/http'
import { idempotencyServiceMock } from '@sim/testing/mocks/idempotency-service.mock'
import {
  webhooksPollingUtilsMock,
  webhooksPollingUtilsMockFns,
} from '@sim/testing/mocks/webhooks-polling-utils.mock'
import {
  webhooksProcessorMock,
  webhooksProcessorMockFns,
} from '@sim/testing/mocks/webhooks-processor.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/idempotency/service', () => idempotencyServiceMock)

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/webhooks/polling/utils', () => webhooksPollingUtilsMock)

import { gmailPollingHandler } from '@/lib/webhooks/polling/gmail'
import type {
  PollWebhookContext,
  WebhookRecord,
  WorkflowRecord,
} from '@/lib/webhooks/polling/types'

const { mockUpdateWebhookProviderConfig: mockUpdateConfig, mockResolveOAuthCredential } =
  webhooksPollingUtilsMockFns
const mockProcessEvent = webhooksProcessorMockFns.mockProcessPolledWebhookEvent

const EXPIRED_HISTORY_ID = '30000'

const WORKFLOW: WorkflowRecord = {
  id: 'gmail-listener',
  userId: 'gmail-owner',
  workspaceId: 'gmail-workspace',
  folderId: null,
  sortOrder: 0,
  name: 'Gmail listener',
  description: null,
  lastSynced: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  isDeployed: true,
  deployedAt: new Date('2026-10-01T00:00:00.000Z'),
  isPublicApi: false,
  locked: false,
  forkSyncExcluded: false,
  runCount: 0,
  lastRunAt: null,
  variables: {},
  archivedAt: null,
}

interface MailboxState {
  profileHistoryId: string
  inboxMessages: { id: string; historyId: string }[]
}

function context(providerConfig: Record<string, unknown>): PollWebhookContext {
  const webhookData: WebhookRecord = {
    id: 'gmail-webhook',
    workflowId: 'gmail-listener',
    deploymentVersionId: null,
    registrationStatus: null,
    registrationGeneration: null,
    configFingerprint: null,
    preparedAt: null,
    blockId: null,
    path: 'gmail-listener',
    routingKey: null,
    provider: 'gmail',
    providerConfig: {
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
      markAsRead: false,
      lastCheckedTimestamp: new Date(Date.now() - 60_000).toISOString(),
      ...providerConfig,
    },
    isActive: true,
    failedCount: 0,
    lastFailedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  }
  return {
    webhookData,
    workflowData: WORKFLOW,
    requestId: 'gmail-request',
    logger: createLogger('GmailTest'),
  }
}

/**
 * A Gmail mailbox whose history records older than the stored cursor have aged out:
 * `history.list` answers 404 for that cursor, as the Gmail sync guide documents.
 */
function mailboxWithExpiredHistory(state: MailboxState) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    if (url.pathname.endsWith('/users/me/history')) {
      return jsonResponse(
        { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } },
        404
      )
    }
    if (url.pathname.endsWith('/users/me/profile')) {
      return jsonResponse({ historyId: state.profileHistoryId })
    }
    if (url.pathname.endsWith('/users/me/messages')) {
      return jsonResponse(
        state.inboxMessages.length
          ? { messages: state.inboxMessages.map(({ id }) => ({ id, threadId: id })) }
          : { resultSizeEstimate: 0 }
      )
    }
    const message = state.inboxMessages.find((m) => url.pathname.endsWith(`/messages/${m.id}`))
    if (message) {
      return jsonResponse({
        id: message.id,
        threadId: message.id,
        historyId: message.historyId,
        labelIds: ['INBOX'],
        payload: { headers: [{ name: 'Subject', value: 'hello' }] },
      })
    }
    return new Response('unexpected request', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function persistedHistoryIds() {
  return mockUpdateConfig.mock.calls.map(
    ([, updates]) => (updates as { historyId?: string }).historyId
  )
}

describe('gmailPollingHandler history cursor', () => {
  beforeEach(() => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    mockProcessEvent.mockResolvedValue({ success: true })
  })

  it('drops a cursor the quiet mailbox cannot replace instead of re-saving the expired one', async () => {
    mailboxWithExpiredHistory({
      profileHistoryId: EXPIRED_HISTORY_ID,
      inboxMessages: [],
    })

    await expect(
      gmailPollingHandler.pollWebhook(context({ historyId: EXPIRED_HISTORY_ID }))
    ).resolves.toBe('success')

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1)
    const [, updates] = mockUpdateConfig.mock.calls[0]
    expect(updates).toHaveProperty('historyId', undefined)
  })

  it('resumes from the newest searched message when the full sync finds mail', async () => {
    mailboxWithExpiredHistory({
      profileHistoryId: '40100',
      inboxMessages: [{ id: 'm-new', historyId: '40050' }],
    })

    await expect(
      gmailPollingHandler.pollWebhook(context({ historyId: EXPIRED_HISTORY_ID }))
    ).resolves.toBe('success')

    expect(mockProcessEvent).toHaveBeenCalledTimes(1)
    expect(persistedHistoryIds()).toEqual(['40050'])
  })

  it('resumes from the mailbox cursor when activity moved it past the expired one', async () => {
    mailboxWithExpiredHistory({ profileHistoryId: '40100', inboxMessages: [] })

    await expect(
      gmailPollingHandler.pollWebhook(context({ historyId: EXPIRED_HISTORY_ID }))
    ).resolves.toBe('success')

    expect(persistedHistoryIds()).toEqual(['40100'])
  })

  it('leaves the stored cursor untouched when a search-mode poll finds no mail', async () => {
    mailboxWithExpiredHistory({ profileHistoryId: '40100', inboxMessages: [] })

    await expect(gmailPollingHandler.pollWebhook(context({}))).resolves.toBe('success')

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1)
    const [, updates] = mockUpdateConfig.mock.calls[0]
    expect(updates).not.toHaveProperty('historyId')
  })
})
