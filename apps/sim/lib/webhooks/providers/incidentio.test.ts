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

  it('rejects requests missing Svix signature headers', async () => {
    const rawBody = JSON.stringify({ event_type: 'public_incident.incident_created_v2' })
    const ts = `${Math.floor(Date.now() / 1000)}`

    const res = await incidentioHandler.verifyAuth!({
      ...baseAuthCtx,
      request: requestWithSvixHeaders('msg_1', ts, rawBody),
      rawBody,
      requestId: 'incidentio-t2',
      providerConfig: { signingSecret: SIGNING_SECRET },
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

  it('matches events by event_type for a specific trigger', async () => {
    const body = { event_type: 'public_incident.incident_created_v2' }

    const matched = await incidentioHandler.matchEvent!({
      body,
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
      requestId: 'incidentio-t6',
      providerConfig: { triggerId: 'incidentio_incident_created' },
    })
    expect(matched).toBe(true)

    const mismatched = await incidentioHandler.matchEvent!({
      body,
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
      requestId: 'incidentio-t7',
      providerConfig: { triggerId: 'incidentio_incident_updated' },
    })
    expect(mismatched).toBe(false)
  })

  it('formats incident_created input from the directly-nested wrapper', async () => {
    const incident = {
      id: 'inc_123',
      reference: 'INC-123',
      name: 'Database outage',
      summary: 'DB is sad',
      incident_status: { id: 'st_1', name: 'Investigating' },
      severity: { id: 'sev_1', name: 'Major' },
      mode: 'standard',
      visibility: 'public',
      permalink: 'https://app.incident.io/incidents/123',
      created_at: '2021-08-17T13:28:57.801578Z',
      updated_at: '2021-08-17T13:28:57.801578Z',
    }
    const body = {
      event_type: 'public_incident.incident_created_v2',
      'public_incident.incident_created_v2': incident,
    }

    const result = await incidentioHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf_1', userId: 'user_1' },
      headers: {},
      requestId: 'incidentio-t8',
    })

    expect(result.input).toEqual({
      event_type: 'public_incident.incident_created_v2',
      incident,
      incident_id: 'inc_123',
      name: 'Database outage',
      reference: 'INC-123',
      summary: 'DB is sad',
      incident_status: { id: 'st_1', name: 'Investigating' },
      severity: { id: 'sev_1', name: 'Major' },
      mode: 'standard',
      visibility: 'public',
      permalink: 'https://app.incident.io/incidents/123',
      created_at: '2021-08-17T13:28:57.801578Z',
      updated_at: '2021-08-17T13:28:57.801578Z',
      new_status: null,
      previous_status: null,
      update_message: null,
      payload: body,
    })
  })

  it('formats incident_status_updated input from the nested incident + status change fields', async () => {
    const incident = { id: 'inc_123', reference: 'INC-123', name: 'Database outage' }
    const new_status = { id: 'st_2', name: 'Resolved' }
    const previous_status = { id: 'st_1', name: 'Investigating' }
    const body = {
      event_type: 'public_incident.incident_status_updated_v2',
      'public_incident.incident_status_updated_v2': {
        incident,
        new_status,
        previous_status,
        message: 'Fixed it',
      },
    }

    const result = await incidentioHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf_1', userId: 'user_1' },
      headers: {},
      requestId: 'incidentio-t8b',
    })

    expect(result.input).toMatchObject({
      event_type: 'public_incident.incident_status_updated_v2',
      incident,
      incident_id: 'inc_123',
      new_status,
      previous_status,
      update_message: 'Fixed it',
      payload: body,
    })
  })

  it('formats alert_created (v1) input from the directly-nested wrapper', async () => {
    const alert = {
      id: 'alrt_1',
      title: 'CPU high',
      description: 'CPU exceeded 75%',
      status: 'firing',
      alert_source_id: 'src_1',
      deduplication_key: 'dedup_1',
      source_url: 'https://alerts.example.com/1',
      created_at: '2021-08-17T13:28:57.801578Z',
      updated_at: '2021-08-17T13:28:57.801578Z',
      resolved_at: '2021-08-17T14:28:57.801578Z',
    }
    const body = {
      event_type: 'public_alert.alert_created_v1',
      'public_alert.alert_created_v1': alert,
    }

    const result = await incidentioHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf_1', userId: 'user_1' },
      headers: {},
      requestId: 'incidentio-t8c',
    })

    expect(result.input).toEqual({
      event_type: 'public_alert.alert_created_v1',
      alert,
      alert_id: 'alrt_1',
      title: 'CPU high',
      description: 'CPU exceeded 75%',
      status: 'firing',
      alert_source_id: 'src_1',
      deduplication_key: 'dedup_1',
      source_url: 'https://alerts.example.com/1',
      created_at: '2021-08-17T13:28:57.801578Z',
      updated_at: '2021-08-17T13:28:57.801578Z',
      resolved_at: '2021-08-17T14:28:57.801578Z',
      payload: body,
    })
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
