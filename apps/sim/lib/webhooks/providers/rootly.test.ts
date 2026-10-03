import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { rootlyHandler } from '@/lib/webhooks/providers/rootly'

function signRootlyBody(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}${rawBody}`, 'utf8').digest('hex')
}

function requestWithRootlySignature(
  secret: string,
  timestamp: string,
  rawBody: string
): NextRequest {
  const signature = signRootlyBody(secret, timestamp, rawBody)
  return new NextRequest('http://localhost/test', {
    headers: {
      'X-Rootly-Signature': `t=${timestamp},v1=${signature}`,
    },
  })
}

describe('Rootly webhook provider', () => {
  it('accepts a correctly signed request within the allowed timestamp window', async () => {
    const secret = 'rootly-secret'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const rawBody = JSON.stringify({
      event: { id: 'evt-1', type: 'incident.created', issued_at: '2022-11-27T19:44:33.633-08:00' },
      data: { id: 'inc-1', title: 'Sparkling Frost' },
    })

    const res = await rootlyHandler.verifyAuth!({
      request: requestWithRootlySignature(secret, timestamp, rawBody),
      rawBody,
      requestId: 'rootly-t1',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })

  it('rejects when the signing secret is missing from config (fail-closed)', async () => {
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const res = await rootlyHandler.verifyAuth!({
      request: new NextRequest('http://localhost/test'),
      rawBody,
      requestId: 'rootly-t1b',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects a request with an invalid signature', async () => {
    const secret = 'rootly-secret'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const req = new NextRequest('http://localhost/test', {
      headers: { 'X-Rootly-Signature': `t=${timestamp},v1=deadbeef` },
    })

    const res = await rootlyHandler.verifyAuth!({
      request: req,
      rawBody,
      requestId: 'rootly-t2',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects when the timestamp skew is too large', async () => {
    const secret = 'rootly-secret'
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString()
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const res = await rootlyHandler.verifyAuth!({
      request: requestWithRootlySignature(secret, timestamp, rawBody),
      rawBody,
      requestId: 'rootly-t4',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('skips events that do not match the configured trigger', async () => {
    const body = { event: { id: 'evt-1', type: 'incident.updated' }, data: { id: 'inc-1' } }
    const matched = await rootlyHandler.matchEvent!({
      body,
      requestId: 'rootly-t5',
      providerConfig: { triggerId: 'rootly_incident_created' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(false)
  })

  it('extracts the event id for idempotency', () => {
    const id = rootlyHandler.extractIdempotencyId!({
      event: { id: 'evt-1', type: 'incident.created' },
      data: {},
    })
    expect(id).toBe('evt-1')
  })
})
