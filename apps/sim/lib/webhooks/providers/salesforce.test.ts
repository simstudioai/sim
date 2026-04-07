import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { salesforceHandler } from '@/lib/webhooks/providers/salesforce'
import { validateZoomSignature, zoomHandler } from '@/lib/webhooks/providers/zoom'
import { isSalesforceEventMatch } from '@/triggers/salesforce/utils'
import { isZoomEventMatch } from '@/triggers/zoom/utils'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Salesforce webhook provider', () => {
  it('verifyAuth rejects when webhookSecret is missing', async () => {
    const res = await salesforceHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts Authorization Bearer secret', async () => {
    const res = await salesforceHandler.verifyAuth!({
      request: reqWithHeaders({ authorization: 'Bearer my-secret-value' }),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { webhookSecret: 'my-secret-value' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('verifyAuth accepts X-Sim-Webhook-Secret', async () => {
    const res = await salesforceHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-sim-webhook-secret': 'abc' }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { webhookSecret: 'abc' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('isSalesforceEventMatch filters record triggers by eventType', () => {
    expect(
      isSalesforceEventMatch('salesforce_record_created', { eventType: 'created' }, undefined)
    ).toBe(true)
    expect(
      isSalesforceEventMatch('salesforce_record_created', { eventType: 'updated' }, undefined)
    ).toBe(false)
    expect(isSalesforceEventMatch('salesforce_record_created', {}, undefined)).toBe(false)
  })

  it('isSalesforceEventMatch enforces objectType config for generic webhook', () => {
    expect(
      isSalesforceEventMatch('salesforce_webhook', { objectType: 'Account', Id: 'x' }, 'Account')
    ).toBe(true)
    expect(
      isSalesforceEventMatch('salesforce_webhook', { objectType: 'Contact', Id: 'x' }, 'Account')
    ).toBe(false)
    expect(isSalesforceEventMatch('salesforce_webhook', { Id: 'x' }, 'Account')).toBe(false)
  })

  it('isSalesforceEventMatch fails closed for record triggers when configured objectType is missing', () => {
    expect(
      isSalesforceEventMatch(
        'salesforce_record_created',
        { eventType: 'created', Id: '001' },
        'Account'
      )
    ).toBe(false)
  })

  it('formatInput maps record trigger fields', async () => {
    const { input } = await salesforceHandler.formatInput!({
      body: {
        eventType: 'created',
        objectType: 'Lead',
        Id: '00Q1',
        Name: 'Test',
      },
      headers: {},
      requestId: 't4',
      webhook: { providerConfig: { triggerId: 'salesforce_record_created' } },
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.eventType).toBe('created')
    expect(i.objectType).toBe('Lead')
    expect(i.recordId).toBe('00Q1')
  })

  it('extractIdempotencyId includes record id', () => {
    const id = salesforceHandler.extractIdempotencyId!({
      eventType: 'created',
      Id: '001',
    })
    expect(id).toContain('001')
  })

  it('extractIdempotencyId is stable without timestamps for identical payloads', () => {
    const body = {
      eventType: 'updated',
      objectType: 'Account',
      Id: '001',
      Name: 'Acme',
      changedFields: ['Name'],
    }

    const first = salesforceHandler.extractIdempotencyId!(body)
    const second = salesforceHandler.extractIdempotencyId!({ ...body })

    expect(first).toBe(second)
    expect(first).toContain('001')
    expect(first).toContain('updated')
  })
})

describe('Zoom webhook provider', () => {
  it('isZoomEventMatch rejects empty event for specialized triggers', () => {
    expect(isZoomEventMatch('zoom_meeting_started', '')).toBe(false)
    expect(isZoomEventMatch('zoom_meeting_started', '   ')).toBe(false)
    expect(isZoomEventMatch('zoom_meeting_started', 'meeting.started')).toBe(true)
    expect(isZoomEventMatch('zoom_webhook', '')).toBe(true)
  })

  it('validateZoomSignature uses raw body bytes, not a re-serialized variant', () => {
    const secret = 'test-secret'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rawA = '{"a":1,"b":2}'
    const rawB = '{"b":2,"a":1}'
    const computed = crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawA}`)
    const hashA = `v0=${computed.digest('hex')}`
    expect(validateZoomSignature(secret, hashA, timestamp, rawA)).toBe(true)
    expect(validateZoomSignature(secret, hashA, timestamp, rawB)).toBe(false)
  })

  it('extractIdempotencyId prefers meeting uuid', () => {
    const zid = zoomHandler.extractIdempotencyId!({
      event: 'meeting.started',
      event_ts: 123,
      payload: { object: { uuid: 'u1', id: 55 } },
    })
    expect(zid).toBe('zoom:meeting.started:123:u1')
  })

  it('extractIdempotencyId uses participant identity when available', () => {
    const zid = zoomHandler.extractIdempotencyId!({
      event: 'meeting.participant_joined',
      event_ts: 123,
      payload: {
        object: {
          uuid: 'meeting-uuid',
          participant: {
            user_id: 'participant-1',
          },
        },
      },
    })
    expect(zid).toBe('zoom:meeting.participant_joined:123:participant-1')
  })

  it('matchEvent never executes endpoint validation payloads', async () => {
    const result = await zoomHandler.matchEvent!({
      webhook: { id: 'w' },
      workflow: { id: 'wf' },
      body: { event: 'endpoint.url_validation' },
      request: reqWithHeaders({}),
      requestId: 't5',
      providerConfig: { triggerId: 'zoom_webhook' },
    })
    expect(result).toBe(false)
  })
})
