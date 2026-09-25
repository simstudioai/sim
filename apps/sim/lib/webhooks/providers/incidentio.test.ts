import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { incidentioHandler } from '@/lib/webhooks/providers/incidentio'

const SECRET_BYTES = Buffer.from('incidentio-test-secret-key-padding!!')
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`

function signIncidentioBody(msgId: string, timestamp: string, rawBody: string): string {
  const toSign = `${msgId}.${timestamp}.${rawBody}`
  const sig = crypto.createHmac('sha256', SECRET_BYTES).update(toSign, 'utf8').digest('base64')
  return `v1,${sig}`
}

function requestWithSvixHeaders(
  msgId: string,
  timestamp: string,
  rawBody: string,
  signature?: string
): NextRequest {
  const headers: Record<string, string> = {
    'webhook-id': msgId,
    'webhook-timestamp': timestamp,
  }
  if (signature !== undefined) {
    headers['webhook-signature'] = signature
  }
  return new NextRequest('http://localhost/test', { headers })
}

const baseAuthCtx = {
  webhook: {},
  workflow: {},
  rawBody: '',
}

describe('incident.io webhook provider', () => {
  it('rejects requests when the signing secret is missing', async () => {
    const res = await incidentioHandler.verifyAuth!({
      ...baseAuthCtx,
      request: requestWithSvixHeaders('msg_1', `${Math.floor(Date.now() / 1000)}`, '{}'),
      rawBody: '{}',
      requestId: 'incidentio-t1',
      providerConfig: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects requests with an invalid signature', async () => {
    const rawBody = JSON.stringify({ event_type: 'public_incident.incident_created_v2' })
    const ts = `${Math.floor(Date.now() / 1000)}`

    const res = await incidentioHandler.verifyAuth!({
      ...baseAuthCtx,
      request: requestWithSvixHeaders('msg_1', ts, rawBody, 'v1,not-a-valid-signature'),
      rawBody,
      requestId: 'incidentio-t3',
      providerConfig: { signingSecret: SIGNING_SECRET },
    })

    expect(res?.status).toBe(401)
  })

  it('rejects requests when the timestamp skew is too large', async () => {
    const rawBody = JSON.stringify({ event_type: 'public_incident.incident_created_v2' })
    const ts = `${Math.floor(Date.now() / 1000) - 600}`
    const signature = signIncidentioBody('msg_1', ts, rawBody)

    const res = await incidentioHandler.verifyAuth!({
      ...baseAuthCtx,
      request: requestWithSvixHeaders('msg_1', ts, rawBody, signature),
      rawBody,
      requestId: 'incidentio-t4',
      providerConfig: { signingSecret: SIGNING_SECRET },
    })

    expect(res?.status).toBe(401)
  })

  it('accepts a correctly signed request within the allowed window', async () => {
    const rawBody = JSON.stringify({ event_type: 'public_incident.incident_created_v2' })
    const ts = `${Math.floor(Date.now() / 1000)}`
    const signature = signIncidentioBody('msg_1', ts, rawBody)

    const res = await incidentioHandler.verifyAuth!({
      ...baseAuthCtx,
      request: requestWithSvixHeaders('msg_1', ts, rawBody, signature),
      rawBody,
      requestId: 'incidentio-t5',
      providerConfig: { signingSecret: SIGNING_SECRET },
    })

    expect(res).toBeNull()
  })

  it('matches the alert_created trigger against public_alert.alert_created_v1', async () => {
    const matched = await incidentioHandler.matchEvent!({
      body: { event_type: 'public_alert.alert_created_v1' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
      requestId: 'incidentio-t9b',
      providerConfig: { triggerId: 'incidentio_alert_created' },
    })
    expect(matched).toBe(true)
  })

  it('extracts an idempotency id from event_type and entity id', () => {
    const body = {
      event_type: 'public_incident.incident_created_v2',
      'public_incident.incident_created_v2': { incident: { id: 'inc_123' } },
    }

    expect(incidentioHandler.extractIdempotencyId!(body)).toBe(
      'public_incident.incident_created_v2:inc_123'
    )
    expect(incidentioHandler.extractIdempotencyId!({})).toBeNull()
  })
})
