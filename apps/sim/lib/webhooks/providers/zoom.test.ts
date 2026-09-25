import crypto from 'node:crypto'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it } from 'vitest'
import { validateZoomSignature, zoomHandler } from '@/lib/webhooks/providers/zoom'
import { isZoomEventMatch } from '@/triggers/zoom/utils'

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

  it('matchEvent never executes endpoint validation payloads', async () => {
    const result = await zoomHandler.matchEvent!({
      webhook: { id: 'w' },
      workflow: { id: 'wf' },
      body: { event: 'endpoint.url_validation' },
      request: createMockRequest({}),
      requestId: 't5',
      providerConfig: { triggerId: 'zoom_webhook' },
    })
    expect(result).toBe(false)
  })
})
