import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { sentryHandler } from '@/lib/webhooks/providers/sentry'

function signSentryBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function requestWithSentrySignature(
  secret: string,
  rawBody: string,
  resource = 'issue'
): NextRequest {
  const signature = signSentryBody(secret, rawBody)
  return new NextRequest('http://localhost/test', {
    headers: {
      'Sentry-Hook-Signature': signature,
      'Sentry-Hook-Resource': resource,
    },
  })
}

describe('Sentry webhook provider', () => {
  it('accepts requests with a valid HMAC signature', async () => {
    const secret = 'sentry-client-secret'
    const rawBody = JSON.stringify({ action: 'created', data: { issue: { id: '1' } } })

    const res = await sentryHandler.verifyAuth!({
      request: requestWithSentrySignature(secret, rawBody),
      rawBody,
      requestId: 'sentry-t1',
      providerConfig: { clientSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })

  it('rejects requests with an invalid signature', async () => {
    const secret = 'sentry-client-secret'
    const rawBody = JSON.stringify({ action: 'created', data: { issue: { id: '1' } } })

    const request = new NextRequest('http://localhost/test', {
      headers: {
        'Sentry-Hook-Signature': 'deadbeef',
        'Sentry-Hook-Resource': 'issue',
      },
    })

    const res = await sentryHandler.verifyAuth!({
      request,
      rawBody,
      requestId: 'sentry-t2',
      providerConfig: { clientSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('skips an issue created trigger when the action is resolved', async () => {
    const rawBody = JSON.stringify({ action: 'resolved', data: { issue: { id: '1' } } })
    const request = new NextRequest('http://localhost/test', {
      headers: { 'Sentry-Hook-Resource': 'issue' },
    })

    const matched = await sentryHandler.matchEvent!({
      body: JSON.parse(rawBody),
      request,
      requestId: 'sentry-t5',
      providerConfig: { triggerId: 'sentry_issue_created' },
      webhook: {},
      workflow: {},
    })

    expect(matched).toBe(false)
  })

  it('skips when the resource header does not match the trigger', async () => {
    const rawBody = JSON.stringify({ action: 'created', data: { error: { event_id: 'abc' } } })
    const request = new NextRequest('http://localhost/test', {
      headers: { 'Sentry-Hook-Resource': 'error' },
    })

    const matched = await sentryHandler.matchEvent!({
      body: JSON.parse(rawBody),
      request,
      requestId: 'sentry-t6',
      providerConfig: { triggerId: 'sentry_issue_created' },
      webhook: {},
      workflow: {},
    })

    expect(matched).toBe(false)
  })

  it('extracts an idempotency id for issue events', () => {
    const id = sentryHandler.extractIdempotencyId!({
      action: 'created',
      data: { issue: { id: '42' } },
    })
    expect(id).toBe('sentry:issue:42:created')
  })
})
