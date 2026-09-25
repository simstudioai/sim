import { hmacSha256Hex } from '@sim/security/hmac'
import { jsonResponse } from '@sim/testing/helpers/http'
import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialOwner } = vi.hoisted(() => ({
  mockGetCredentialOwner: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig || {},
  getNotificationUrl: () => 'https://app.example.com/api/webhooks/trigger/clickup-path',
  getCredentialOwner: mockGetCredentialOwner,
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

import { clickupHandler } from '@/lib/webhooks/providers/clickup'

const mockRefreshAccessTokenIfNeeded = authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded

const fetchMock = vi.fn()

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
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
    vi.stubGlobal('fetch', fetchMock)
    mockGetCredentialOwner.mockResolvedValue({ userId: 'user-1', accountId: 'account-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('oauth-token')
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
  })

  describe('createSubscription', () => {
    const validConfig = {
      triggerId: 'clickup_task_created',
      credentialId: 'cred-1',
      triggerWorkspaceId: '108',
    }

    it('rolls back the created webhook and throws when no secret is returned', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'ext-3', webhook: { id: 'ext-3' } }))
      fetchMock.mockResolvedValueOnce(jsonResponse({}))

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
    it('throws on failure only when strict', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
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
  })
})
