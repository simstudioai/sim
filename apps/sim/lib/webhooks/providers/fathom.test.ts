import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { fathomHandler } from '@/lib/webhooks/providers/fathom'

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
