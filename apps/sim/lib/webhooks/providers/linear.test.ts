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

  it('accepts signed requests within the 5-minute skew window (wider than Linear’s literal 60s suggestion, to tolerate retries)', async () => {
    const secret = 'linear-secret'
    const rawBody = JSON.stringify({
      action: 'update',
      type: 'Issue',
      webhookTimestamp: Date.now() - 61_000,
    })

    const res = await linearHandler.verifyAuth!({
      request: requestWithLinearSignature(secret, rawBody),
      rawBody,
      requestId: 'linear-t4',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })

  it('skips verification entirely when no webhookSecret is configured', async () => {
    const rawBody = JSON.stringify({ action: 'create', type: 'Issue' })

    const res = await linearHandler.verifyAuth!({
      request: new NextRequest('http://localhost/test'),
      rawBody,
      requestId: 'linear-t5',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })

  describe('extractIdempotencyId', () => {
    it('builds a stable key from type, action, entity id, and updatedAt', () => {
      const key = linearHandler.extractIdempotencyId!({
        type: 'Issue',
        action: 'update',
        data: { id: 'issue-1', updatedAt: '2026-07-08T00:00:00.000Z' },
      })

      expect(key).toBe('linear:Issue:update:issue-1:2026-07-08T00:00:00.000Z')
    })

    it('falls back to createdAt when updatedAt is absent (create events)', () => {
      const key = linearHandler.extractIdempotencyId!({
        type: 'Comment',
        action: 'create',
        data: { id: 'comment-1', createdAt: '2026-07-08T00:00:00.000Z' },
      })

      expect(key).toBe('linear:Comment:create:comment-1:2026-07-08T00:00:00.000Z')
    })

    it('returns null when the entity id is missing', () => {
      const key = linearHandler.extractIdempotencyId!({ type: 'Issue', action: 'create' })
      expect(key).toBeNull()
    })

    it('returns null when type is missing', () => {
      const key = linearHandler.extractIdempotencyId!({ action: 'create', data: { id: 'x' } })
      expect(key).toBeNull()
    })

    it('returns null instead of throwing when the body is null', () => {
      expect(linearHandler.extractIdempotencyId!(null)).toBeNull()
    })

    it('returns null instead of throwing when the body is a non-object', () => {
      expect(linearHandler.extractIdempotencyId!('not an object')).toBeNull()
      expect(linearHandler.extractIdempotencyId!(42)).toBeNull()
      expect(linearHandler.extractIdempotencyId!(['array'])).toBeNull()
    })
  })
})
