/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialOwner, mockRefreshAccessTokenIfNeeded } = vi.hoisted(() => ({
  mockGetCredentialOwner: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig || {},
  getNotificationUrl: () => 'https://app.example.com/api/webhooks/trigger/clickup-path',
  getCredentialOwner: mockGetCredentialOwner,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

import { clickupHandler } from '@/lib/webhooks/providers/clickup'

const fetchMock = vi.fn()

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: { id: 'webhook-row-1', path: 'clickup-path', providerConfig },
    workflow: {},
    userId: 'user-1',
    requestId: 'req-1',
  } as never
}

describe('ClickUp webhook provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockGetCredentialOwner.mockResolvedValue({ userId: 'user-1', accountId: 'account-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('oauth-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('verifyAuth', () => {
    it('fails closed when no webhookSecret is configured', async () => {
      const res = await clickupHandler.verifyAuth!({
        request: reqWithHeaders({}),
        rawBody: '{}',
        requestId: 't1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects when the X-Signature header is missing', async () => {
      const res = await clickupHandler.verifyAuth!({
        request: reqWithHeaders({}),
        rawBody: '{}',
        requestId: 't2',
        providerConfig: { webhookSecret: 'secret' },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects an invalid signature', async () => {
      const res = await clickupHandler.verifyAuth!({
        request: reqWithHeaders({ 'X-Signature': 'deadbeef' }),
        rawBody: '{"event":"taskCreated"}',
        requestId: 't3',
        providerConfig: { webhookSecret: 'secret' },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('accepts a valid HMAC-SHA256 hex signature over the raw body', async () => {
      const rawBody = '{"event":"taskCreated","task_id":"abc"}'
      const signature = hmacSha256Hex(rawBody, 'secret')
      const res = await clickupHandler.verifyAuth!({
        request: reqWithHeaders({ 'X-Signature': signature }),
        rawBody,
        requestId: 't4',
        providerConfig: { webhookSecret: 'secret' },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('matchEvent', () => {
    it('passes when the event matches the trigger', async () => {
      const result = await clickupHandler.matchEvent!({
        webhook: { id: 'w1' },
        workflow: { id: 'wf1' },
        body: { event: 'taskCreated' },
        request: reqWithHeaders({}),
        requestId: 't5',
        providerConfig: { triggerId: 'clickup_task_created' },
      })
      expect(result).toBe(true)
    })

    it('skips with a response when the event does not match', async () => {
      const result = await clickupHandler.matchEvent!({
        webhook: { id: 'w1' },
        workflow: { id: 'wf1' },
        body: { event: 'taskDeleted' },
        request: reqWithHeaders({}),
        requestId: 't6',
        providerConfig: { triggerId: 'clickup_task_created' },
      })
      expect(result).toBeInstanceOf(NextResponse)
    })

    it('passes all events through for the catch-all trigger', async () => {
      const result = await clickupHandler.matchEvent!({
        webhook: { id: 'w1' },
        workflow: { id: 'wf1' },
        body: { event: 'goalCreated' },
        request: reqWithHeaders({}),
        requestId: 't7',
        providerConfig: { triggerId: 'clickup_webhook' },
      })
      expect(result).toBe(true)
    })
  })

  describe('extractIdempotencyId', () => {
    it('derives the documented webhook_id:history_item_id key', () => {
      const body = {
        event: 'taskCreated',
        webhook_id: 'wh-1',
        task_id: 'abc',
        history_items: [{ id: 'hist-1' }],
      }
      expect(clickupHandler.extractIdempotencyId!(body)).toBe('clickup:wh-1:hist-1')
      expect(clickupHandler.extractIdempotencyId!({ ...body })).toBe('clickup:wh-1:hist-1')
    })

    it('returns null without history items or webhook_id', () => {
      expect(
        clickupHandler.extractIdempotencyId!({ event: 'taskCreated', webhook_id: 'wh-1' })
      ).toBeNull()
      expect(
        clickupHandler.extractIdempotencyId!({
          event: 'taskCreated',
          history_items: [{ id: 'h1' }],
        })
      ).toBeNull()
    })
  })

  describe('formatInput', () => {
    const baseBody = {
      event: 'taskCreated',
      webhook_id: 'wh-1',
      task_id: 'abc',
      history_items: [{ id: 'h1' }],
    }

    function formatCtx(triggerId: string, body: Record<string, unknown>) {
      return {
        webhook: { providerConfig: { triggerId } },
        workflow: { id: 'wf1', userId: 'user-1' },
        body,
        headers: {},
        requestId: 't8',
      } as never
    }

    it('maps task events to the task output keys', async () => {
      const { input } = await clickupHandler.formatInput!(
        formatCtx('clickup_task_created', baseBody)
      )
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual([
        'eventType',
        'historyItems',
        'payload',
        'taskId',
      ])
      expect((input as Record<string, unknown>).taskId).toBe('abc')
    })

    it('maps list events to the list output keys', async () => {
      const body = { event: 'listCreated', webhook_id: 'wh-1', list_id: '162641285' }
      const { input } = await clickupHandler.formatInput!(formatCtx('clickup_list_created', body))
      expect((input as Record<string, unknown>).listId).toBe('162641285')
      expect((input as Record<string, unknown>).eventType).toBe('listCreated')
    })

    it('maps goal events to the documented base keys only', async () => {
      const body = { event: 'goalCreated', webhook_id: 'wh-1' }
      const { input } = await clickupHandler.formatInput!(formatCtx('clickup_goal_created', body))
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual([
        'eventType',
        'historyItems',
        'payload',
      ])
    })

    it('maps the catch-all trigger to the generic output keys', async () => {
      const { input } = await clickupHandler.formatInput!(formatCtx('clickup_webhook', baseBody))
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual([
        'eventType',
        'folderId',
        'historyItems',
        'listId',
        'payload',
        'spaceId',
        'taskId',
      ])
    })
  })

  describe('createSubscription', () => {
    const validConfig = {
      triggerId: 'clickup_task_created',
      credentialId: 'cred-1',
      triggerWorkspaceId: '108',
    }

    it('creates the webhook and returns externalId + webhookSecret', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: 'ext-1', webhook: { id: 'ext-1', secret: 'shh' } })
      )

      const result = await clickupHandler.createSubscription!(createContext(validConfig))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.clickup.com/api/v2/team/108/webhook')
      expect(init.headers.Authorization).toBe('Bearer oauth-token')
      expect(JSON.parse(init.body)).toEqual({
        endpoint: 'https://app.example.com/api/webhooks/trigger/clickup-path',
        events: ['taskCreated'],
      })
      expect(result?.providerConfigUpdates).toEqual({ externalId: 'ext-1', webhookSecret: 'shh' })
    })

    it('subscribes with the wildcard for the catch-all trigger and coerces location filters', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: 'ext-2', webhook: { secret: 'shh' } })
      )

      await clickupHandler.createSubscription!(
        createContext({
          triggerId: 'clickup_webhook',
          credentialId: 'cred-1',
          triggerWorkspaceId: '108',
          triggerSpaceId: '1234',
          triggerListId: '9876',
          triggerTaskId: 'abc1234',
        })
      )

      const [, init] = fetchMock.mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({
        endpoint: 'https://app.example.com/api/webhooks/trigger/clickup-path',
        events: ['*'],
        space_id: 1234,
        list_id: 9876,
        task_id: 'abc1234',
      })
    })

    it('throws a friendly error when the workspace is missing', async () => {
      await expect(
        clickupHandler.createSubscription!(
          createContext({ triggerId: 'clickup_task_created', credentialId: 'cred-1' })
        )
      ).rejects.toThrow(/workspace is required/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws a friendly error on 401 from ClickUp', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { err: 'Token invalid' }))
      await expect(clickupHandler.createSubscription!(createContext(validConfig))).rejects.toThrow(
        /authentication failed/i
      )
    })

    it('rolls back the created webhook and throws when no secret is returned', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'ext-3', webhook: { id: 'ext-3' } }))
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(clickupHandler.createSubscription!(createContext(validConfig))).rejects.toThrow(
        /no signing secret/i
      )

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]
      expect(deleteUrl).toBe('https://api.clickup.com/api/v2/webhook/ext-3')
      expect(deleteInit.method).toBe('DELETE')
    })

    it('rejects non-integer location filters before calling ClickUp', async () => {
      await expect(
        clickupHandler.createSubscription!(
          createContext({ ...validConfig, triggerSpaceId: 'not-a-number' })
        )
      ).rejects.toThrow(/Space ID must be a whole number/)
      await expect(
        clickupHandler.createSubscription!(
          createContext({ ...validConfig, triggerSpaceId: '12.5' })
        )
      ).rejects.toThrow(/Space ID must be a whole number/)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('deleteSubscription', () => {
    it('deletes the external webhook', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
      await clickupHandler.deleteSubscription!({
        webhook: {
          id: 'webhook-row-1',
          providerConfig: { externalId: 'ext-1', credentialId: 'cred-1' },
        },
        workflow: {},
        requestId: 'req-1',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.clickup.com/api/v2/webhook/ext-1')
      expect(init.method).toBe('DELETE')
    })

    it('tolerates 404 and never throws when not strict', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, {}))
      await expect(
        clickupHandler.deleteSubscription!({
          webhook: {
            id: 'webhook-row-1',
            providerConfig: { externalId: 'ext-1', credentialId: 'cred-1' },
          },
          workflow: {},
          requestId: 'req-1',
        })
      ).resolves.toBeUndefined()
    })

    it('throws on failure only when strict', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(500, {}))
      await expect(
        clickupHandler.deleteSubscription!({
          webhook: {
            id: 'webhook-row-1',
            providerConfig: { externalId: 'ext-1', credentialId: 'cred-1' },
          },
          workflow: {},
          requestId: 'req-1',
          strict: true,
        })
      ).rejects.toThrow(/Failed to delete ClickUp webhook/)
    })

    it('skips gracefully when externalId is missing', async () => {
      await expect(
        clickupHandler.deleteSubscription!({
          webhook: { id: 'webhook-row-1', providerConfig: { credentialId: 'cred-1' } },
          workflow: {},
          requestId: 'req-1',
        })
      ).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
