import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  quickBooksHandler,
  verifyQuickBooksSignature,
  verifyQuickBooksSignatureAgainstVerifierTokens,
} from '@/lib/webhooks/providers/quickbooks'
import {
  isQuickBooksEventMatch,
  quickBooksEventTypesSubBlockId,
} from '@/triggers/quickbooks/quickbooks'

const event = {
  specversion: '1.0',
  id: 'event-1',
  source: 'quickbooks-online',
  type: 'qbo.invoice.updated.v1',
  datacontenttype: 'application/json',
  time: '2026-08-03T12:00:00Z',
  intuitentityid: '123',
  intuitaccountid: '456',
  data: { changedFields: ['Balance'] },
}

describe('QuickBooks webhook provider', () => {
  it('verifies the documented base64 HMAC over the raw body', () => {
    const body = JSON.stringify([event])
    const signature = crypto.createHmac('sha256', 'verifier').update(body).digest('base64')
    expect(verifyQuickBooksSignature(body, signature, 'verifier', 'request-1')).toBeNull()
    expect(verifyQuickBooksSignature(body, 'invalid', 'verifier', 'request-2')?.status).toBe(401)
    expect(verifyQuickBooksSignature(body, null, 'verifier', 'request-3')?.status).toBe(401)
    expect(
      verifyQuickBooksSignatureAgainstVerifierTokens(
        body,
        signature,
        ['different-verifier', 'verifier'],
        'request-4'
      )
    ).toBeNull()
  })

  it('matches only configured actions for the selected entity', () => {
    expect(
      isQuickBooksEventMatch('quickbooks_invoice_events', event.type, ['created', 'updated'])
    ).toBe(true)
    expect(isQuickBooksEventMatch('quickbooks_invoice_events', event.type, ['created'])).toBe(false)
    expect(isQuickBooksEventMatch('quickbooks_bill_events', event.type, ['updated'])).toBe(false)
  })

  it('normalizes Intuit void events to the configured voided action', async () => {
    for (const entity of ['invoice', 'payment']) {
      const voidEvent = { ...event, type: `qbo.${entity}.void.v1` }
      expect(
        isQuickBooksEventMatch(`quickbooks_${entity}_events`, voidEvent.type, ['voided'])
      ).toBe(true)

      const result = await quickBooksHandler.formatInput!({
        body: voidEvent,
        webhook: {},
        workflow: { id: 'workflow-1', userId: 'user-1' },
        headers: {},
        requestId: `request-${entity}`,
      })
      expect(result.input).toMatchObject({
        eventType: `qbo.${entity}.void.v1`,
        entityType: entity,
        action: 'voided',
      })
    }
  })

  it('formats only the common verified event fields', async () => {
    const result = await quickBooksHandler.formatInput!({
      body: event,
      webhook: {},
      workflow: { id: 'workflow-1', userId: 'user-1' },
      headers: {},
      requestId: 'request-4',
    })
    expect(result.input).toEqual({
      eventId: 'event-1',
      eventType: 'qbo.invoice.updated.v1',
      entityType: 'invoice',
      action: 'updated',
      entityId: '123',
      realmId: '456',
      eventTime: '2026-08-03T12:00:00Z',
      specVersion: '1.0',
      source: 'quickbooks-online',
      contentType: 'application/json',
      data: { changedFields: ['Balance'] },
    })
    expect(quickBooksHandler.extractIdempotencyId!(event)).toBe('event-1')
  })

  it('uses the provider-local ingress and durable queue modes', async () => {
    expect(quickBooksHandler.ingressMode).toBe('provider')
    expect(quickBooksHandler.executionMode).toBe('queue')
    const matched = await quickBooksHandler.matchEvent!({
      body: event,
      request: new NextRequest('http://localhost'),
      requestId: 'request-5',
      providerConfig: {
        triggerId: 'quickbooks_invoice_events',
        [quickBooksEventTypesSubBlockId('quickbooks_invoice_events')]: ['updated'],
      },
      webhook: {},
      workflow: {},
    })
    expect(matched).toBe(true)
  })
})
