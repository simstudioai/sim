/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: vi.fn(),
  getNotificationUrl: vi.fn(() => 'https://example.com/api/webhooks/trigger/path'),
}))

import { zohoDeskHandler } from '@/lib/webhooks/providers/zoho-desk'

function makeAuthContext(headers: Record<string, string>, providerConfig: Record<string, unknown>) {
  return {
    webhook: {},
    workflow: {},
    request: { headers: new Headers(headers) } as unknown as Request,
    rawBody: '',
    requestId: 'test',
    providerConfig,
  }
}

describe('zohoDeskHandler', () => {
  it('acknowledges ingress via the durable queue (5s deadline)', () => {
    expect(zohoDeskHandler.executionMode).toBe('queue')
  })

  describe('verifyAuth', () => {
    it('rejects requests without the X-ZDesk-JWT header', async () => {
      const result = await zohoDeskHandler.verifyAuth?.(
        // biome-ignore lint/suspicious/noExplicitAny: minimal context for the header-only path
        makeAuthContext({}, { orgId: '1', webhookId: '2' }) as any
      )
      expect(result).not.toBeNull()
      expect(result?.status).toBe(401)
    })
  })

  describe('createSubscription', () => {
    it('throws a clear error when the organization ID is missing', async () => {
      await expect(
        zohoDeskHandler.createSubscription?.({
          webhook: { providerConfig: { eventType: 'Ticket_Add' } },
          workflow: {},
          userId: 'user-1',
          requestId: 'test',
          // biome-ignore lint/suspicious/noExplicitAny: request is unused on this guard path
          request: {} as any,
        })
      ).rejects.toThrow(/Organization ID/i)
    })

    it('throws a clear error when the event type is missing', async () => {
      await expect(
        zohoDeskHandler.createSubscription?.({
          webhook: { providerConfig: { orgId: '700123' } },
          workflow: {},
          userId: 'user-1',
          requestId: 'test',
          // biome-ignore lint/suspicious/noExplicitAny: request is unused on this guard path
          request: {} as any,
        })
      ).rejects.toThrow(/event type/i)
    })
  })

  describe('formatInput', () => {
    it('maps a Zoho Desk event array to the trigger outputs', async () => {
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body: [
          {
            eventType: 'Ticket_Add',
            eventTime: '1700000000000',
            orgId: '700123',
            payload: { id: 'ticket-1' },
            prevState: null,
          },
        ],
        headers: {},
        requestId: 'test',
      })
      expect(result?.input).toMatchObject({
        eventType: 'Ticket_Add',
        eventTime: '1700000000000',
        orgId: '700123',
        payload: { id: 'ticket-1' },
      })
    })

    it('passes through a non-array body unchanged', async () => {
      const body = { unexpected: true }
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body,
        headers: {},
        requestId: 'test',
      })
      expect(result?.input).toBe(body)
    })
  })
})
