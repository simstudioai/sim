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
import { OutboundRoutingError } from '@/lib/core/network/routing'

vi.mock('@/lib/core/idempotency/service', () => idempotencyServiceMock)

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/webhooks/polling/utils', () => webhooksPollingUtilsMock)

import { gmailPollingHandler } from '@/lib/webhooks/polling/gmail'
import type {
  PollWebhookContext,
  WebhookRecord,
  WorkflowRecord,
} from '@/lib/webhooks/polling/types'

const {
  mockUpdateWebhookProviderConfig: mockUpdateConfig,
  mockResolveOAuthCredential,
  mockMarkWebhookFailed,
} = webhooksPollingUtilsMockFns
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
  return fetchMock
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

describe('gmailPollingHandler egress outage', () => {
  it('skips the poll without counting a failure when the egress route is down', async () => {
    mockResolveOAuthCredential.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(gmailPollingHandler.pollWebhook(context({}))).resolves.toBe('skipped')

    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
  })

  it('leaves the mail for a later poll without counting a failure when the route drops mid-batch', async () => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    mailboxWithExpiredHistory({
      profileHistoryId: '40100',
      inboxMessages: [{ id: 'm-new', historyId: '40050' }],
    })
    mockProcessEvent.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(gmailPollingHandler.pollWebhook(context({}))).resolves.toBe('skipped')

    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('keeps the cursor when the route drops after earlier mail in the batch succeeded', async () => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    mailboxWithExpiredHistory({
      profileHistoryId: '40100',
      inboxMessages: [
        { id: 'm-first', historyId: '40040' },
        { id: 'm-second', historyId: '40050' },
      ],
    })
    mockProcessEvent
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(gmailPollingHandler.pollWebhook(context({}))).resolves.toBe('skipped')

    expect(mockProcessEvent).toHaveBeenCalledTimes(2)
    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('delivers a message once even when marking it read hits an outage', async () => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    mockProcessEvent.mockResolvedValue({ success: true })
    const fetchMock = mailboxWithExpiredHistory({
      profileHistoryId: '40100',
      inboxMessages: [{ id: 'm-new', historyId: '40050' }],
    })
    const mailbox = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/modify')) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      return mailbox ? mailbox(input) : jsonResponse({})
    })

    await expect(gmailPollingHandler.pollWebhook(context({ markAsRead: true }))).resolves.toBe(
      'success'
    )

    expect(mockProcessEvent).toHaveBeenCalledTimes(1)
    expect(mockUpdateConfig).toHaveBeenCalled()
  })

  it('keeps the history cursor when the route drops while fetching message details', async () => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        if (url.pathname.endsWith('/users/me/history')) {
          return jsonResponse({
            historyId: '40100',
            history: [{ messagesAdded: [{ message: { id: 'm-new' } }] }],
          })
        }
        throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      })
    )

    await expect(
      gmailPollingHandler.pollWebhook(context({ historyId: EXPIRED_HISTORY_ID }))
    ).resolves.toBe('skipped')

    expect(mockProcessEvent).not.toHaveBeenCalled()
    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('leaves mail for a later poll instead of emitting it without attachments when the route drops', async () => {
    mockResolveOAuthCredential.mockResolvedValue('access-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        if (url.pathname.includes('/attachments/')) {
          throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
        }
        if (url.pathname.endsWith('/users/me/messages')) {
          return jsonResponse({ messages: [{ id: 'm-new', threadId: 'm-new' }] })
        }
        return jsonResponse({
          id: 'm-new',
          threadId: 'm-new',
          historyId: '40050',
          labelIds: ['INBOX'],
          payload: {
            headers: [{ name: 'Subject', value: 'invoice' }],
            parts: [{ filename: 'invoice.pdf', body: { attachmentId: 'att-1', size: 10 } }],
          },
        })
      })
    )

    await expect(
      gmailPollingHandler.pollWebhook(context({ includeAttachments: true }))
    ).resolves.toBe('skipped')

    expect(mockProcessEvent).not.toHaveBeenCalled()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })
})
