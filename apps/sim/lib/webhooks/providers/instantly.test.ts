import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { instantlyHandler } from '@/lib/webhooks/providers/instantly'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Instantly webhook provider', () => {
  it('verifyAuth rejects when secretToken is missing (fail-closed)', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects an incorrect token', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-sim-webhook-token': 'wrong-token' }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { secretToken: 'expected-token' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts a matching token', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-sim-webhook-token': 'expected-token' }),
      rawBody: '{}',
      requestId: 't4',
      providerConfig: { secretToken: 'expected-token' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const matched = await instantlyHandler.matchEvent!({
      body: { event_type: 'email_opened' },
      requestId: 't6',
      providerConfig: { triggerId: 'instantly_email_sent' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(false)
  })

  it('matchEvent accepts both link-click event type spellings', async () => {
    const matchedA = await instantlyHandler.matchEvent!({
      body: { event_type: 'link_clicked' },
      requestId: 't8a',
      providerConfig: { triggerId: 'instantly_link_clicked' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    const matchedB = await instantlyHandler.matchEvent!({
      body: { event_type: 'email_link_clicked' },
      requestId: 't8b',
      providerConfig: { triggerId: 'instantly_link_clicked' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matchedA).toBe(true)
    expect(matchedB).toBe(true)
  })

  describe('extractIdempotencyId', () => {
    it('prefers the email_id when present, qualified by timestamp', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_sent',
        email_id: 'email-123',
        campaign_id: 'camp-1',
        lead_email: 'lead@example.com',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      expect(id).toBe('instantly:email_sent:email-123:2026-07-08T12:00:00.000Z')
    })

    it('returns null when email_id is present but timestamp is missing, rather than risk a false collision', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_sent',
        email_id: 'email-123',
      })
      expect(id).toBeNull()
    })

    it('falls back to a content-based key without an email_id', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'lead_interested',
        campaign_id: 'camp-1',
        lead_email: 'lead@example.com',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      expect(id).toBe('instantly:lead_interested:camp-1:lead@example.com:2026-07-08T12:00:00.000Z')
    })

    it('does not collide across distinct occurrences of the same email_id (e.g. repeat opens/clicks/replies)', () => {
      const firstOpen = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_opened',
        email_id: 'email-123',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      const secondOpen = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_opened',
        email_id: 'email-123',
        timestamp: '2026-07-08T13:30:00.000Z',
      })
      expect(firstOpen).not.toBe(secondOpen)
    })
  })
})
