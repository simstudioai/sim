import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clerkHandler } from '@/lib/webhooks/providers/clerk'

const SECRET_BASE64 = Buffer.from('clerk-test-signing-secret').toString('base64')
const SIGNING_SECRET = `whsec_${SECRET_BASE64}`

function signSvix(msgId: string, timestamp: string, body: string): string {
  const toSign = `${msgId}.${timestamp}.${body}`
  const sig = crypto
    .createHmac('sha256', Buffer.from(SECRET_BASE64, 'base64'))
    .update(toSign, 'utf8')
    .digest('base64')
  return `v1,${sig}`
}

function makeRequest(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as unknown as Parameters<
    NonNullable<typeof clerkHandler.verifyAuth>
  >[0]['request']
}

describe('Clerk webhook provider', () => {
  it('verifyAuth accepts a valid Svix signature', async () => {
    const msgId = 'msg_123'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rawBody = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } })
    const signature = signSvix(msgId, timestamp, rawBody)

    const result = await clerkHandler.verifyAuth!({
      request: makeRequest({
        'svix-id': msgId,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      }),
      rawBody,
      requestId: 'test',
      providerConfig: { signingSecret: SIGNING_SECRET },
      webhook: {},
      workflow: {},
    })

    expect(result).toBeNull()
  })

  it('verifyAuth rejects an invalid Svix signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rawBody = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } })

    const result = await clerkHandler.verifyAuth!({
      request: makeRequest({
        'svix-id': 'msg_123',
        'svix-timestamp': timestamp,
        'svix-signature': 'v1,not-a-valid-signature',
      }),
      rawBody,
      requestId: 'test',
      providerConfig: { signingSecret: SIGNING_SECRET },
      webhook: {},
      workflow: {},
    })

    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })

  it('verifyAuth rejects when the signing secret is missing', async () => {
    const result = await clerkHandler.verifyAuth!({
      request: makeRequest({
        'svix-id': 'msg_123',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,whatever',
      }),
      rawBody: '{}',
      requestId: 'test',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })

    expect(result?.status).toBe(401)
  })

  it('extractIdempotencyId derives a stable, timestamp-free key from type and data id', () => {
    const id = clerkHandler.extractIdempotencyId!({
      type: 'user.updated',
      timestamp: 1654012591835,
      data: { id: 'user_1' },
    })
    expect(id).toBe('user.updated:user_1')
  })
})
