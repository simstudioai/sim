import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fathomHandler } from '@/lib/webhooks/providers/fathom'
import type { SubscriptionContext } from '@/lib/webhooks/providers/types'

const SECRET_BYTES = Buffer.from('fathom-test-secret-key-padding!!!!!!')
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`

function sign(msgId: string, timestamp: string, rawBody: string): string {
  const sig = crypto
    .createHmac('sha256', SECRET_BYTES)
    .update(`${msgId}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64')
  return `v1,${sig}`
}

function request(msgId: string, timestamp: string, signature: string): NextRequest {
  return new NextRequest('http://localhost/test', {
    headers: {
      'webhook-id': msgId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
  })
}

const nowSeconds = () => `${Math.floor(Date.now() / 1000)}`
const rawBody = JSON.stringify({ title: 'QBR', recording_id: 123 })

describe('Fathom webhook provider verifyAuth', () => {
  it('rejects a forged delivery when the webhook has a signing secret', async () => {
    const res = await fathomHandler.verifyAuth?.({
      webhook: {},
      workflow: {},
      request: request('msg_1', nowSeconds(), 'v1,Zm9yZ2Vk'),
      rawBody,
      requestId: 'fathom-t1',
      providerConfig: { signingSecret: SIGNING_SECRET },
    })

    expect(res?.status).toBe(401)
  })

  it('accepts a correctly signed delivery', async () => {
    const ts = nowSeconds()
    const res = await fathomHandler.verifyAuth?.({
      webhook: {},
      workflow: {},
      request: request('msg_1', ts, sign('msg_1', ts, rawBody)),
      rawBody,
      requestId: 'fathom-t2',
      providerConfig: { signingSecret: SIGNING_SECRET },
    })

    expect(res).toBeNull()
  })

  it('keeps accepting webhooks registered before the secret was stored', async () => {
    const res = await fathomHandler.verifyAuth?.({
      webhook: {},
      workflow: {},
      request: request('msg_1', nowSeconds(), 'v1,Zm9yZ2Vk'),
      rawBody,
      requestId: 'fathom-t3',
      providerConfig: {},
    })

    expect(res ?? null).toBeNull()
  })
})

describe('Fathom webhook provider createSubscription', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  function subscriptionContext(webhook: Record<string, unknown>): SubscriptionContext {
    return {
      webhook,
      workflow: {},
      userId: 'user_1',
      requestId: `fathom-${String(webhook.id)}`,
      request: new NextRequest('http://localhost/api/webhooks'),
    }
  }

  it('stores the signing secret Fathom returns', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'ikEoQ4bVoq4JYUmc', secret: SIGNING_SECRET }),
    })

    const result = await fathomHandler.createSubscription?.(
      subscriptionContext({ id: 'wh_1', path: 'p1', providerConfig: { apiKey: 'fathom_key' } })
    )

    expect(result?.providerConfigUpdates).toEqual({
      externalId: 'ikEoQ4bVoq4JYUmc',
      signingSecret: SIGNING_SECRET,
    })
  })

  it('deletes the webhook and fails when the response omits the signing secret', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'ikEoQ4bVoq4JYUmc' }),
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })

    await expect(
      fathomHandler.createSubscription?.(
        subscriptionContext({ id: 'wh_2', path: 'p2', providerConfig: { apiKey: 'fathom_key' } })
      )
    ).rejects.toThrow(/signing secret/)

    const [url, init] = fetchMock.mock.calls[1]
    expect(init.method).toBe('DELETE')
    expect(url).toBe('https://api.fathom.ai/external/v1/webhooks/ikEoQ4bVoq4JYUmc')
  })
})
