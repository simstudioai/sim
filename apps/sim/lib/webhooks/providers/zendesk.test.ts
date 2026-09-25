import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { zendeskHandler } from '@/lib/webhooks/providers/zendesk'

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

  describe('createSubscription', () => {
    it('rejects a subdomain containing a path separator to prevent host-boundary escape', async () => {
      await expect(
        zendeskHandler.createSubscription!({
          webhook: {
            id: 'wh-1',
            path: 'p',
            providerConfig: {
              subdomain: 'evil.example.com/x',
              email: 'admin@example.com',
              apiToken: 'token',
            },
          },
          workflow: {},
          userId: 'u1',
          requestId: 't11',
          request: reqWithHeaders({}),
        })
      ).rejects.toThrow(/subdomain must contain only letters, numbers, and hyphens/)
    })
  })

  describe('deleteSubscription', () => {
    it('throws (strict) when the stored subdomain is invalid', async () => {
      await expect(
        zendeskHandler.deleteSubscription!({
          webhook: {
            id: 'wh-4',
            providerConfig: {
              subdomain: 'evil.example.com/x',
              email: 'admin@example.com',
              apiToken: 'token',
              externalId: 'ext-1',
            },
          },
          workflow: {},
          requestId: 't14',
          strict: true,
        })
      ).rejects.toThrow(/Invalid Zendesk subdomain/)
    })
  })

  describe('extractIdempotencyId', () => {
    it('returns the stable event id', () => {
      expect(zendeskHandler.extractIdempotencyId!({ id: 'evt-1' })).toBe('evt-1')
    })
  })
})
