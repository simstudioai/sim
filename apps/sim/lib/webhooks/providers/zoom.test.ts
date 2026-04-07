import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { validateZoomSignature, zoomHandler } from '@/lib/webhooks/providers/zoom'
import { isZoomEventMatch } from '@/triggers/zoom/utils'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

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

  it('formatInput passes through the Zoom webhook envelope', async () => {
    const body = {
      event: 'meeting.started',
      event_ts: 1700000000000,
      payload: { account_id: 'acct', object: { id: 1 } },
    }
    const { input } = await zoomHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body,
      headers: {},
      requestId: 'zoom-format',
    })
    expect(input).toBe(body)
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
