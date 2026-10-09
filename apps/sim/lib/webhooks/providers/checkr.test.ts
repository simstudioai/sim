import crypto from 'crypto'
import { jsonResponse } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it, vi } from 'vitest'
import { checkrHandler } from '@/lib/webhooks/providers/checkr'
import type {
  AuthContext,
  EventMatchContext,
  SubscriptionContext,
} from '@/lib/webhooks/providers/types'

const API_KEY = 'checkr-secret-key'

function sign(body: string, key = API_KEY): string {
  return crypto.createHmac('sha256', key).update(body, 'utf8').digest('hex')
}

function authContext(rawBody: string, headers: Record<string, string>, apiKey?: string) {
  return {
    request: createMockRequest('POST', JSON.parse(rawBody), headers),
    rawBody,
    requestId: 'r1',
    providerConfig: apiKey === undefined ? {} : { apiKey },
    webhook: {},
    workflow: {},
  } satisfies AuthContext
}

function matchContext(body: unknown, triggerId: string): EventMatchContext {
  return {
    webhook: { id: 'w1' },
    workflow: {},
    body,
    request: createMockRequest('POST', body),
    requestId: 'r1',
    providerConfig: { triggerId },
  }
}

const event = {
  id: '507f1f77bcf86cd799439011',
  object: 'event',
  type: 'report.completed',
  created_at: '2014-01-18T12:34:00Z',
  data: { object: { id: '4722c07dd9a10c3985ae432a', object: 'report', status: 'complete' } },
  account_id: 'e9b18321a51bdab376045be8',
}

describe('checkrHandler.verifyAuth', () => {
  const rawBody = JSON.stringify(event)

  it('rejects a delivery when the trigger has no API key to verify with', () => {
    const res = checkrHandler.verifyAuth?.(
      authContext(rawBody, { 'x-checkr-signature': sign(rawBody) })
    )
    expect(res?.status).toBe(401)
  })

  it('rejects a delivery without a signature header', () => {
    const res = checkrHandler.verifyAuth?.(authContext(rawBody, {}, API_KEY))
    expect(res?.status).toBe(401)
  })

  it('rejects a signature made with a different key', () => {
    const res = checkrHandler.verifyAuth?.(
      authContext(rawBody, { 'x-checkr-signature': sign(rawBody, 'other-key') }, API_KEY)
    )
    expect(res?.status).toBe(401)
  })

  it('rejects a valid signature replayed onto a different body', () => {
    const tampered = JSON.stringify({ ...event, type: 'report.engaged' })
    const res = checkrHandler.verifyAuth?.(
      authContext(tampered, { 'x-checkr-signature': sign(rawBody) }, API_KEY)
    )
    expect(res?.status).toBe(401)
  })

  it('accepts a signature over the compact body', () => {
    const res = checkrHandler.verifyAuth?.(
      authContext(rawBody, { 'x-checkr-signature': sign(rawBody) }, API_KEY)
    )
    expect(res).toBeNull()
  })

  it('accepts a compact-JSON signature when the delivered body was reformatted', () => {
    const pretty = JSON.stringify(event, null, 2)
    const res = checkrHandler.verifyAuth?.(
      authContext(pretty, { 'x-checkr-signature': sign(rawBody) }, API_KEY)
    )
    expect(res).toBeNull()
  })
})

describe('checkrHandler.matchEvent', () => {
  it('skips an event whose type is not the configured trigger', async () => {
    await expect(
      checkrHandler.matchEvent?.(matchContext(event, 'checkr_report_created'))
    ).resolves.toBe(false)
  })

  it('runs the configured trigger for its own event type', async () => {
    await expect(
      checkrHandler.matchEvent?.(matchContext(event, 'checkr_report_completed'))
    ).resolves.toBe(true)
  })

  it('runs the all-events trigger for any event type', async () => {
    const packageEvent = { ...event, type: 'package.created' }
    await expect(
      checkrHandler.matchEvent?.(matchContext(packageEvent, 'checkr_webhook'))
    ).resolves.toBe(true)
  })
})

describe('checkrHandler.createSubscription', () => {
  const ctx = {
    requestId: 'req-1',
    userId: 'u1',
    workflow: {},
    request: createMockRequest('POST'),
    webhook: {
      id: 'wh-1',
      path: 'abc',
      providerConfig: { apiKey: API_KEY, triggerId: 'checkr_report_completed' },
    },
  } satisfies SubscriptionContext

  const respondWith = (body: unknown, status: number) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)))
  }

  it('explains the two-webhook account limit instead of the raw API error', async () => {
    respondWith({ error: 'Allowed webhook API limit exceeded.' }, 400)
    await expect(checkrHandler.createSubscription?.(ctx)).rejects.toThrow(/at most two webhooks/)
  })

  it('fails the deploy when Checkr returns no webhook ID to delete later', async () => {
    respondWith({ object: 'webhook' }, 201)
    await expect(checkrHandler.createSubscription?.(ctx)).rejects.toThrow(/did not return its ID/)
  })
})

describe('checkrHandler.deleteSubscription', () => {
  const strictDelete = () =>
    checkrHandler.deleteSubscription?.({
      requestId: 'req-1',
      strict: true,
      webhook: { id: 'wh-1', providerConfig: { apiKey: API_KEY, externalId: 'ext-1' } },
      workflow: {},
    })

  it('treats an already-deleted webhook as cleaned up in strict mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(strictDelete()).resolves.toBeUndefined()
  })

  it('surfaces a failed deletion in strict mode so the webhook is not orphaned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500)))
    await expect(strictDelete()).rejects.toThrow(/Failed to delete Checkr webhook/)
  })
})
