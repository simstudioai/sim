/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { photonImessageHandler } from '@/lib/webhooks/providers/photon-imessage'
import { buildPhotonImessageOutputs } from '@/triggers/photon_imessage/utils'

const SECRET = 'whsec_test_secret'

const textBody = {
  event: 'messages',
  message: {
    id: 'msg-123',
    platform: 'imessage',
    direction: 'inbound',
    timestamp: '2026-08-21T10:00:00.000Z',
    sender: { id: '+14155551234', platform: 'imessage' },
    space: { id: 'any;-;+14155551234', platform: 'imessage', type: 'dm' },
    content: { type: 'text', text: 'hello there' },
  },
}

/** Photon signs `v0:<timestamp>:<rawBody>` and sends `v0=<hex>`. */
function sign(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`, 'utf8')
    .digest('hex')
  return `v0=${digest}`
}

function authContext(overrides: {
  rawBody: string
  signature?: string
  timestamp?: string
  withoutSecret?: boolean
}) {
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = { 'x-spectrum-timestamp': timestamp }
  const signature = overrides.signature ?? sign(SECRET, timestamp, overrides.rawBody)
  if (signature) {
    headers['x-spectrum-signature'] = signature
  }

  return {
    request: new NextRequest('http://localhost/api/webhooks/trigger/test', { headers }),
    rawBody: overrides.rawBody,
    requestId: 'r1',
    providerConfig: overrides.withoutSecret ? {} : { webhookSecret: SECRET },
    webhook: {},
    workflow: {},
  } as any
}

describe('photonImessageHandler', () => {
  describe('verifyAuth', () => {
    it('accepts a correctly signed delivery', async () => {
      const rawBody = JSON.stringify(textBody)
      const result = await photonImessageHandler.verifyAuth!(authContext({ rawBody }))
      expect(result).toBeNull()
    })

    it('rejects a delivery whose body was tampered with after signing', async () => {
      const rawBody = JSON.stringify(textBody)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const signature = sign(SECRET, timestamp, rawBody)
      const tampered = JSON.stringify({
        ...textBody,
        message: { ...textBody.message, content: { type: 'text', text: 'transfer $1000' } },
      })

      const result = await photonImessageHandler.verifyAuth!(
        authContext({ rawBody: tampered, signature, timestamp })
      )
      expect(result?.status).toBe(401)
    })

    it('rejects a replayed delivery outside the 5-minute window', async () => {
      const rawBody = JSON.stringify(textBody)
      const stale = String(Math.floor(Date.now() / 1000) - 600)

      const result = await photonImessageHandler.verifyAuth!(
        authContext({ rawBody, timestamp: stale, signature: sign(SECRET, stale, rawBody) })
      )
      expect(result?.status).toBe(401)
    })

    it('rejects a delivery with no signature header', async () => {
      const rawBody = JSON.stringify(textBody)
      const result = await photonImessageHandler.verifyAuth!(
        authContext({ rawBody, signature: '' })
      )
      expect(result?.status).toBe(401)
    })

    // Fails closed, unlike createHmacVerifier's default of skipping verification.
    it('rejects when no webhook secret is configured', async () => {
      const rawBody = JSON.stringify(textBody)
      const result = await photonImessageHandler.verifyAuth!(
        authContext({ rawBody, withoutSecret: true })
      )
      expect(result?.status).toBe(401)
    })
  })

  describe('shouldSkipEvent', () => {
    it('processes an inbound text message', () => {
      expect(
        photonImessageHandler.shouldSkipEvent!({ body: textBody, requestId: 'r1' } as any)
      ).toBe(false)
    })

    it('skips a read receipt, which is a signal rather than a received message', () => {
      const body = {
        ...textBody,
        message: { ...textBody.message, content: { type: 'read', target: { id: 'msg-1' } } },
      }
      expect(photonImessageHandler.shouldSkipEvent!({ body, requestId: 'r1' } as any)).toBe(true)
    })

    it('skips an event that is not a message envelope', () => {
      expect(
        photonImessageHandler.shouldSkipEvent!({ body: { hello: 'world' }, requestId: 'r1' } as any)
      ).toBe(true)
    })
  })

  describe('formatInput', () => {
    it('maps a text message onto the trigger outputs', async () => {
      const result = await photonImessageHandler.formatInput!({
        body: textBody,
        requestId: 'r1',
      } as any)
      const input = result.input as Record<string, unknown>

      expect(input.messageId).toBe('msg-123')
      expect(input.text).toBe('hello there')
      expect(input.contentType).toBe('text')
      expect(input.senderId).toBe('+14155551234')
      expect(input.chatId).toBe('any;-;+14155551234')
      expect(input.chatType).toBe('dm')
      expect(input.platform).toBe('imessage')
      expect(input.attachments).toEqual([])
    })

    it('reads the text out of a reply through its inner content', async () => {
      const body = {
        ...textBody,
        message: {
          ...textBody.message,
          content: {
            type: 'reply',
            content: { type: 'text', text: 'replying to you' },
            target: { id: 'msg-1', contentPreview: 'original' },
          },
        },
      }

      const result = await photonImessageHandler.formatInput!({ body, requestId: 'r1' } as any)
      const input = result.input as Record<string, unknown>
      expect(input.text).toBe('replying to you')
      expect(input.contentType).toBe('reply')
    })

    it('summarizes attachment metadata from a grouped message', async () => {
      const body = {
        ...textBody,
        message: {
          ...textBody.message,
          content: {
            type: 'group',
            items: [
              { id: 'a', content: { type: 'text', text: 'look at this' } },
              {
                id: 'b',
                content: {
                  type: 'attachment',
                  id: 'att-1',
                  name: 'photo.jpg',
                  mimeType: 'image/jpeg',
                  size: 2048,
                },
              },
            ],
          },
        },
      }

      const result = await photonImessageHandler.formatInput!({ body, requestId: 'r1' } as any)
      const input = result.input as Record<string, unknown>
      expect(input.text).toBe('look at this')
      expect(input.attachments).toEqual([
        { id: 'att-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 2048 },
      ])
    })

    // Nothing type-checks this link, so a drift here silently empties the editor's tag dropdown.
    it('emits exactly the keys declared by the trigger outputs', async () => {
      const result = await photonImessageHandler.formatInput!({
        body: textBody,
        requestId: 'r1',
      } as any)

      expect(Object.keys(result.input as Record<string, unknown>).sort()).toEqual(
        Object.keys(buildPhotonImessageOutputs()).sort()
      )
    })
  })

  describe('extractIdempotencyId', () => {
    it('keys on the message id so an at-least-once retry collapses to one run', () => {
      expect(photonImessageHandler.extractIdempotencyId!(textBody)).toBe('photon_imessage:msg-123')
    })

    it('returns null when there is no message id to key on', () => {
      expect(photonImessageHandler.extractIdempotencyId!({ event: 'messages' })).toBeNull()
    })
  })
})
