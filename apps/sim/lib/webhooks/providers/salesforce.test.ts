import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { salesforceHandler } from '@/lib/webhooks/providers/salesforce'
import { isSalesforceEventMatch } from '@/triggers/salesforce/utils'

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
        simEventType: 'after_insert',
        objectType: 'Lead',
        Id: '00Q1',
        Name: 'Test',
        OwnerId: '005OWNER',
        SystemModstamp: '2024-01-01T00:00:00.000Z',
      },
      headers: {},
      requestId: 't4',
      webhook: { providerConfig: { triggerId: 'salesforce_record_created' } },
      workflow: { id: 'w', userId: 'u' },
    })
    const i = input as Record<string, unknown>
    expect(i.eventType).toBe('created')
    expect(i.simEventType).toBe('after_insert')
    expect(i.objectType).toBe('Lead')
    expect(i.recordId).toBe('00Q1')
    const rec = i.record as Record<string, unknown>
    expect(rec.OwnerId).toBe('005OWNER')
    expect(rec.SystemModstamp).toBe('2024-01-01T00:00:00.000Z')
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
