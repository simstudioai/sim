/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseSenderAllowlist,
  photonImessageHandler,
} from '@/lib/webhooks/providers/photon-imessage'
import {
  buildPhotonImessageOutputs,
  buildPhotonImessageReactionOutputs,
  buildPhotonImessageReadReceiptOutputs,
  buildPhotonImessageWebhookOutputs,
} from '@/triggers/photon_imessage/utils'

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

const reactionBody = {
  ...textBody,
  message: {
    ...textBody.message,
    id: 'reaction-1',
    content: {
      type: 'reaction',
      emoji: '❤️',
      target: { id: 'msg-9', contentPreview: 'the original' },
    },
  },
}

const readBody = {
  ...textBody,
  message: {
    ...textBody.message,
    id: 'read-1',
    content: { type: 'read', target: { id: 'msg-9' } },
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
    providerConfig: overrides.withoutSecret ? {} : { signingSecret: SECRET },
    webhook: {},
    workflow: {},
  } as any
}

const matchContext = (body: unknown, providerConfig: Record<string, unknown>) =>
  ({ body, providerConfig, requestId: 'r1', webhook: {}, workflow: {}, request: {} }) as any

const formatContext = (body: unknown, triggerId?: string) =>
  ({
    body,
    requestId: 'r1',
    webhook: { providerConfig: triggerId ? { triggerId } : {} },
    workflow: { id: 'w1', userId: 'u1' },
    headers: {},
    query: {},
    method: 'POST',
  }) as any

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
    it('rejects when no signing secret is configured', async () => {
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

    it('keeps read receipts flowing so the read-receipt trigger can claim them', () => {
      expect(
        photonImessageHandler.shouldSkipEvent!({ body: readBody, requestId: 'r1' } as any)
      ).toBe(false)
    })

    it('skips a typing signal, which never fires any trigger', () => {
      const body = {
        ...textBody,
        message: { ...textBody.message, content: { type: 'typing', state: 'start' } },
      }
      expect(photonImessageHandler.shouldSkipEvent!({ body, requestId: 'r1' } as any)).toBe(true)
    })

    it('skips an event that is not a message envelope', () => {
      expect(
        photonImessageHandler.shouldSkipEvent!({ body: { hello: 'world' }, requestId: 'r1' } as any)
      ).toBe(true)
    })
  })

  describe('matchEvent', () => {
    it('routes a text message to the message trigger but not the reaction trigger', () => {
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(textBody, { triggerId: 'photon_imessage_message_received' })
        )
      ).toBe(true)
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(textBody, { triggerId: 'photon_imessage_reaction_received' })
        )
      ).toBe(false)
    })

    it('routes reactions and read receipts to their dedicated triggers only', () => {
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(reactionBody, { triggerId: 'photon_imessage_reaction_received' })
        )
      ).toBe(true)
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(reactionBody, { triggerId: 'photon_imessage_message_received' })
        )
      ).toBe(false)
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(readBody, { triggerId: 'photon_imessage_read_receipt' })
        )
      ).toBe(true)
      expect(
        photonImessageHandler.matchEvent!(
          matchContext(readBody, { triggerId: 'photon_imessage_message_received' })
        )
      ).toBe(false)
    })

    it('routes everything to the catch-all trigger', () => {
      for (const body of [textBody, reactionBody, readBody]) {
        expect(
          photonImessageHandler.matchEvent!(
            matchContext(body, { triggerId: 'photon_imessage_webhook' })
          )
        ).toBe(true)
      }
    })

    it('enforces the sender allowlist case-insensitively', () => {
      const config = {
        triggerId: 'photon_imessage_message_received',
        triggerSenderAllowlist: '+14155551234, Name@iCloud.com',
      }
      expect(photonImessageHandler.matchEvent!(matchContext(textBody, config))).toBe(true)

      const stranger = {
        ...textBody,
        message: { ...textBody.message, sender: { id: '+19998887777', platform: 'imessage' } },
      }
      expect(photonImessageHandler.matchEvent!(matchContext(stranger, config))).toBe(false)

      const emailSender = {
        ...textBody,
        message: { ...textBody.message, sender: { id: 'name@icloud.com', platform: 'imessage' } },
      }
      expect(photonImessageHandler.matchEvent!(matchContext(emailSender, config))).toBe(true)
    })
  })

  describe('parseSenderAllowlist', () => {
    it('splits on commas and newlines, trims, lowercases, and drops empties', () => {
      expect(parseSenderAllowlist(' +1555 , \nA@B.com,,')).toEqual(['+1555', 'a@b.com'])
      expect(parseSenderAllowlist(undefined)).toEqual([])
    })
  })

  describe('formatInput', () => {
    it('maps a text message onto the message trigger outputs', async () => {
      const result = await photonImessageHandler.formatInput!(
        formatContext(textBody, 'photon_imessage_message_received')
      )
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

      const result = await photonImessageHandler.formatInput!(
        formatContext(body, 'photon_imessage_message_received')
      )
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

      const result = await photonImessageHandler.formatInput!(
        formatContext(body, 'photon_imessage_message_received')
      )
      const input = result.input as Record<string, unknown>
      expect(input.text).toBe('look at this')
      expect(input.attachments).toEqual([
        { id: 'att-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 2048 },
      ])
    })

    it('maps a reaction onto the reaction trigger outputs', async () => {
      const result = await photonImessageHandler.formatInput!(
        formatContext(reactionBody, 'photon_imessage_reaction_received')
      )
      const input = result.input as Record<string, unknown>
      expect(input.emoji).toBe('❤️')
      expect(input.targetMessageId).toBe('msg-9')
      expect(input.targetPreview).toBe('the original')
      expect(input.senderId).toBe('+14155551234')
    })

    it('maps a read receipt onto the read-receipt trigger outputs', async () => {
      const result = await photonImessageHandler.formatInput!(
        formatContext(readBody, 'photon_imessage_read_receipt')
      )
      const input = result.input as Record<string, unknown>
      expect(input.targetMessageId).toBe('msg-9')
      expect(input.readerId).toBe('+14155551234')
    })

    // Nothing type-checks this link, so a drift here silently empties the editor's tag dropdown.
    it('emits exactly the keys each trigger declares', async () => {
      const cases: Array<[unknown, string, Record<string, unknown>]> = [
        [textBody, 'photon_imessage_message_received', buildPhotonImessageOutputs()],
        [reactionBody, 'photon_imessage_reaction_received', buildPhotonImessageReactionOutputs()],
        [readBody, 'photon_imessage_read_receipt', buildPhotonImessageReadReceiptOutputs()],
        [textBody, 'photon_imessage_webhook', buildPhotonImessageWebhookOutputs()],
      ]

      for (const [body, triggerId, outputs] of cases) {
        const result = await photonImessageHandler.formatInput!(formatContext(body, triggerId))
        expect(Object.keys(result.input as Record<string, unknown>).sort()).toEqual(
          Object.keys(outputs).sort()
        )
      }
    })
  })

  describe('extractIdempotencyId', () => {
    it('keys on the message id so an at-least-once retry collapses to one run', () => {
      expect(photonImessageHandler.extractIdempotencyId!(textBody)).toBe('photon_imessage:msg-123')
      expect(photonImessageHandler.extractIdempotencyId!({})).toBeNull()
    })
  })

  describe('subscriptions', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const subscriptionContext = (providerConfig: Record<string, unknown>) =>
      ({
        webhook: {
          id: 'wh-1',
          path: 'hook-path',
          providerConfig,
        },
        workflow: {},
        userId: 'u1',
        requestId: 'r1',
        request: {},
      }) as any

    const CREDS = { triggerProjectId: 'proj-1', triggerProjectSecret: 'secret-1' }

    it('registers the webhook and persists the id and signing secret', async () => {
      const calls: Array<{ url: string; method: string; auth: string | null }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          calls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
          })
          return new Response(
            JSON.stringify({
              succeed: true,
              data: { id: 'wh-ext-1', webhookUrl: 'https://x', signingSecret: 'sig-1' },
            }),
            { status: 200 }
          )
        })
      )

      const result = await photonImessageHandler.createSubscription!(subscriptionContext(CREDS))

      expect(result?.providerConfigUpdates).toEqual({
        externalId: 'wh-ext-1',
        signingSecret: 'sig-1',
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://spectrum.photon.codes/projects/proj-1/webhooks/')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].auth).toBe(`Basic ${Buffer.from('proj-1:secret-1').toString('base64')}`)
    })

    it('re-keys on 409 by deleting the stale registration and creating a fresh one', async () => {
      let posts = 0
      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (method === 'POST') {
          posts += 1
          if (posts === 1) {
            return new Response(JSON.stringify({}), { status: 409 })
          }
          return new Response(
            JSON.stringify({
              succeed: true,
              data: { id: 'wh-ext-2', signingSecret: 'sig-2' },
            }),
            { status: 200 }
          )
        }
        if (method === 'DELETE') {
          return new Response(JSON.stringify({ succeed: true, data: { id: 'wh-old' } }), {
            status: 200,
          })
        }
        // List call: the stale record must match the notification URL to be deleted.
        const notificationUrl = (
          await import('@/lib/webhooks/provider-subscription-utils')
        ).getNotificationUrl({ id: 'wh-1', path: 'hook-path', providerConfig: {} })
        return new Response(
          JSON.stringify({
            succeed: true,
            data: [{ id: 'wh-old', webhookUrl: notificationUrl }],
          }),
          { status: 200 }
        )
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await photonImessageHandler.createSubscription!(subscriptionContext(CREDS))

      expect(result?.providerConfigUpdates).toEqual({
        externalId: 'wh-ext-2',
        signingSecret: 'sig-2',
      })
      const methods = fetchMock.mock.calls.map((c) => c[1]?.method ?? 'GET')
      expect(methods).toEqual(['POST', 'GET', 'DELETE', 'POST'])
    })

    it('maps a 401 to a friendly credentials error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({}), { status: 401 }))
      )

      await expect(
        photonImessageHandler.createSubscription!(subscriptionContext(CREDS))
      ).rejects.toThrow(/Invalid Photon project credentials/)
    })

    it('requires credentials before calling the API', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        photonImessageHandler.createSubscription!(subscriptionContext({}))
      ).rejects.toThrow(/Photon project credentials are required/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('deletes the registration and tolerates a 404', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        photonImessageHandler.deleteSubscription!({
          webhook: {
            id: 'wh-1',
            providerConfig: { ...CREDS, externalId: 'wh-ext-1' },
          },
          workflow: {},
          requestId: 'r1',
        } as any)
      ).resolves.toBeUndefined()
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://spectrum.photon.codes/projects/proj-1/webhooks/wh-ext-1/'
      )
    })

    it('rethrows delete failures only in strict mode', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 500 }))
      )

      await expect(
        photonImessageHandler.deleteSubscription!({
          webhook: { id: 'wh-1', providerConfig: { ...CREDS, externalId: 'wh-ext-1' } },
          workflow: {},
          requestId: 'r1',
          strict: true,
        } as any)
      ).rejects.toThrow(/Failed to delete Photon webhook/)

      await expect(
        photonImessageHandler.deleteSubscription!({
          webhook: { id: 'wh-1', providerConfig: { ...CREDS, externalId: 'wh-ext-1' } },
          workflow: {},
          requestId: 'r1',
        } as any)
      ).resolves.toBeUndefined()
    })
  })
})
