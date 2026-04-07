import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { linearHandler } from '@/lib/webhooks/providers/linear'

function signLinearBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function requestWithLinearSignature(secret: string, rawBody: string): NextRequest {
  const signature = signLinearBody(secret, rawBody)
  return new NextRequest('http://localhost/test', {
    headers: {
      'Linear-Signature': signature,
    },
  })
}

describe('Linear webhook provider', () => {
  it('rejects signed requests when webhookTimestamp is missing', async () => {
    const secret = 'linear-secret'
    const rawBody = JSON.stringify({
      action: 'create',
      type: 'Issue',
    })

    const res = await linearHandler.verifyAuth!({
      request: requestWithLinearSignature(secret, rawBody),
      rawBody,
      requestId: 'linear-t1',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects signed requests when webhookTimestamp skew is too large', async () => {
    const secret = 'linear-secret'
    const rawBody = JSON.stringify({
      action: 'update',
      type: 'Issue',
      webhookTimestamp: Date.now() - 600_000,
    })

    const res = await linearHandler.verifyAuth!({
      request: requestWithLinearSignature(secret, rawBody),
      rawBody,
      requestId: 'linear-t2',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('accepts signed requests within the allowed timestamp window', async () => {
    const secret = 'linear-secret'
    const rawBody = JSON.stringify({
      action: 'update',
      type: 'Issue',
      webhookTimestamp: Date.now(),
    })

    const res = await linearHandler.verifyAuth!({
      request: requestWithLinearSignature(secret, rawBody),
      rawBody,
      requestId: 'linear-t3',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })
})
