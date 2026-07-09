/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { zendeskHandler } from '@/lib/webhooks/providers/zendesk'
import { isZendeskEventMatch } from '@/triggers/zendesk/utils'

const SECRET = 'my-signing-secret'

function sign(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(timestamp + body, 'utf8')
    .digest('base64')
}

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Zendesk webhook provider', () => {
  describe('verifyAuth', () => {
    it('rejects when webhookSecret is missing', async () => {
      const res = await zendeskHandler.verifyAuth!({
        request: reqWithHeaders({}),
        rawBody: '{}',
        requestId: 't1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects when signature headers are missing', async () => {
      const res = await zendeskHandler.verifyAuth!({
        request: reqWithHeaders({}),
        rawBody: '{}',
        requestId: 't2',
        providerConfig: { webhookSecret: SECRET },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects a stale timestamp outside the allowed skew window', async () => {
      const body = '{}'
      const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const signature = sign(SECRET, timestamp, body)
      const res = await zendeskHandler.verifyAuth!({
        request: reqWithHeaders({
          'X-Zendesk-Webhook-Signature': signature,
          'X-Zendesk-Webhook-Signature-Timestamp': timestamp,
        }),
        rawBody: body,
        requestId: 't3',
        providerConfig: { webhookSecret: SECRET },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects an invalid signature', async () => {
      const body = '{}'
      const timestamp = new Date().toISOString()
      const res = await zendeskHandler.verifyAuth!({
        request: reqWithHeaders({
          'X-Zendesk-Webhook-Signature': 'not-a-real-signature',
          'X-Zendesk-Webhook-Signature-Timestamp': timestamp,
        }),
        rawBody: body,
        requestId: 't4',
        providerConfig: { webhookSecret: SECRET },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('accepts a valid base64 HMAC-SHA256 signature over timestamp + body', async () => {
      const body = JSON.stringify({ id: 'evt-1', type: 'zen:event-type:ticket.created' })
      const timestamp = new Date().toISOString()
      const signature = sign(SECRET, timestamp, body)
      const res = await zendeskHandler.verifyAuth!({
        request: reqWithHeaders({
          'X-Zendesk-Webhook-Signature': signature,
          'X-Zendesk-Webhook-Signature-Timestamp': timestamp,
        }),
        rawBody: body,
        requestId: 't5',
        providerConfig: { webhookSecret: SECRET },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('isZendeskEventMatch', () => {
    it('matches the configured trigger to its native event type', () => {
      expect(isZendeskEventMatch('zendesk_ticket_created', 'zen:event-type:ticket.created')).toBe(
        true
      )
      expect(
        isZendeskEventMatch('zendesk_ticket_created', 'zen:event-type:ticket.status_changed')
      ).toBe(false)
      expect(isZendeskEventMatch('zendesk_webhook', 'zen:event-type:ticket.created')).toBe(true)
    })
  })

  describe('matchEvent', () => {
    it('passes through all events for the all-events trigger', async () => {
      const result = await zendeskHandler.matchEvent!({
        body: { type: 'zen:event-type:ticket.status_changed' },
        requestId: 't6',
        providerConfig: { triggerId: 'zendesk_webhook' },
        webhook: {},
        workflow: {},
        request: reqWithHeaders({}),
      })
      expect(result).toBe(true)
    })

    it('filters events that do not match the configured trigger', async () => {
      const result = await zendeskHandler.matchEvent!({
        body: { type: 'zen:event-type:ticket.status_changed' },
        requestId: 't7',
        providerConfig: { triggerId: 'zendesk_ticket_created' },
        webhook: {},
        workflow: {},
        request: reqWithHeaders({}),
      })
      expect(result).toBe(false)
    })

    it('does not throw when body is null', async () => {
      const result = await zendeskHandler.matchEvent!({
        body: null,
        requestId: 't8',
        providerConfig: { triggerId: 'zendesk_ticket_created' },
        webhook: {},
        workflow: {},
        request: reqWithHeaders({}),
      })
      expect(result).toBe(false)
    })
  })

  describe('formatInput', () => {
    it('maps the event-subscription envelope to the declared output schema', async () => {
      const { input } = await zendeskHandler.formatInput!({
        body: {
          id: 'evt-1',
          type: 'zen:event-type:ticket.created',
          time: '2026-01-01T00:00:00Z',
          account_id: 123,
          detail: {
            id: '456',
            subject: 'Help',
            status: 'new',
            priority: 'high',
            type: 'incident',
            description: 'desc',
            requester_id: '1',
            assignee_id: '2',
            group_id: '3',
            organization_id: '4',
            tags: ['a', 'b'],
            via: { channel: 'web' },
            is_public: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          event: { current: 'high', previous: 'normal' },
        },
        headers: {},
        requestId: 't9',
        webhook: {},
        workflow: { id: 'w', userId: 'u' },
      })
      const i = input as Record<string, unknown>
      expect(i.event_id).toBe('evt-1')
      expect(i.event_type).toBe('zen:event-type:ticket.created')
      expect(i.account_id).toBe(123)
      const ticket = i.ticket as Record<string, unknown>
      expect(ticket.id).toBe('456')
      expect(ticket.ticket_type).toBe('incident')
      expect(ticket.via_channel).toBe('web')
      expect(ticket.tags).toEqual(['a', 'b'])
      expect(i.event).toEqual({ current: 'high', previous: 'normal' })
    })

    it('does not throw and degrades gracefully when body is null', async () => {
      const { input } = await zendeskHandler.formatInput!({
        body: null,
        headers: {},
        requestId: 't10',
        webhook: {},
        workflow: { id: 'w', userId: 'u' },
      })
      const i = input as Record<string, unknown>
      expect(i.event_id).toBeUndefined()
      const ticket = i.ticket as Record<string, unknown>
      expect(ticket.id).toBeUndefined()
      expect(ticket.tags).toEqual([])
    })
  })

  describe('extractIdempotencyId', () => {
    it('returns the stable event id', () => {
      expect(zendeskHandler.extractIdempotencyId!({ id: 'evt-1' })).toBe('evt-1')
    })

    it('returns null when there is no id', () => {
      expect(zendeskHandler.extractIdempotencyId!({})).toBeNull()
    })

    it('does not throw when body is null', () => {
      expect(zendeskHandler.extractIdempotencyId!(null)).toBeNull()
    })
  })
})
