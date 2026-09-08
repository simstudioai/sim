/** @vitest-environment node */

import crypto from 'node:crypto'
import { requestUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'

const { mockVerifierTokens, mockEnqueue, mockRelease } = vi.hoisted(() => ({
  mockVerifierTokens: vi.fn(),
  mockEnqueue: vi.fn(),
  mockRelease: vi.fn(),
}))

vi.mock('@/background/quickbooks-webhook-ingress', () => ({
  enqueueQuickBooksWebhookIngress: mockEnqueue,
}))
vi.mock('@/lib/core/admission/gate', () => ({
  admissionRejectedResponse: vi.fn(() => new Response(null, { status: 503 })),
  tryAdmit: vi.fn(() => ({ release: mockRelease })),
}))
vi.mock('@/lib/webhooks/quickbooks-credentials', () => ({
  streamQuickBooksWebhookVerifierTokensByAppKey: mockVerifierTokens,
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler:
    (
      handler: (
        request: NextRequest,
        context: { params: Promise<{ appKey: string }> }
      ) => Promise<Response>
    ) =>
    (request: NextRequest, context: { params: Promise<{ appKey: string }> }) =>
      handler(request, context),
}))

import { POST } from '@/app/api/webhooks/quickbooks/[appKey]/route'

const APP_KEY = 'a'.repeat(43)
const validEvent = {
  specversion: '1.0',
  id: 'event-1',
  source: 'quickbooks-online',
  type: 'qbo.invoice.created.v1',
  time: '2026-08-03T12:00:00Z',
  intuitentityid: '123',
  intuitaccountid: '456',
}

function request(body: string, signature?: string): NextRequest {
  return new NextRequest(`http://localhost/api/webhooks/quickbooks/${APP_KEY}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'intuit-signature': signature } : {}),
    },
    body,
  })
}

function signedRequest(value: unknown, verifierToken = 'verifier'): NextRequest {
  const body = JSON.stringify(value)
  const signature = crypto.createHmac('sha256', verifierToken).update(body).digest('base64')
  return request(body, signature)
}

function callPost(webhookRequest: NextRequest, appKey = APP_KEY): Promise<Response> {
  return POST(webhookRequest, { params: Promise.resolve({ appKey }) })
}

function mockTokens(...tokens: string[]): void {
  mockVerifierTokens.mockImplementation(async function* (): AsyncGenerator<string> {
    yield* tokens
  })
}

describe('QuickBooks webhook ingress route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokens('verifier')
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
    mockEnqueue.mockResolvedValue('job-1')
  })

  afterAll(() => {
    requestUtilsMockFns.mockGenerateRequestId.mockReset()
  })

  it('accepts a signed multi-company batch for the addressed user-owned app', async () => {
    const response = await callPost(
      signedRequest([validEvent, { ...validEvent, id: 'event-2', intuitaccountid: '789' }])
    )
    expect(response.status).toBe(200)
    expect(mockVerifierTokens).toHaveBeenCalledWith(APP_KEY)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        appKey: APP_KEY,
        events: [validEvent, { ...validEvent, id: 'event-2', intuitaccountid: '789' }],
        requestId: 'request-1',
      })
    )
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('accepts any verifier token configured by a connection for the same Intuit app', async () => {
    mockTokens('stale-verifier', 'current-verifier')

    expect((await callPost(signedRequest([validEvent], 'current-verifier'))).status).toBe(200)
  })

  it('fails closed for unknown app keys and missing signatures', async () => {
    expect((await callPost(signedRequest([validEvent]), 'invalid')).status).toBe(404)
    mockTokens()
    expect((await callPost(signedRequest([validEvent]))).status).toBe(401)
    mockTokens('verifier')
    expect((await callPost(request(JSON.stringify([validEvent])))).status).toBe(401)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('acknowledges a batch that carries an unmodelled event instead of stalling the app queue', async () => {
    const unmodelledEvent = { ...validEvent, id: 'event-2', type: undefined }
    const response = await callPost(signedRequest([validEvent, unmodelledEvent]))

    expect(response.status).toBe(200)
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ events: [validEvent] }))
  })

  it('acknowledges a batch whose events are all unmodelled without enqueueing', async () => {
    expect((await callPost(signedRequest([{ id: 'event-1' }]))).status).toBe(200)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rejects malformed signed payloads and batches over the event bound', async () => {
    expect((await callPost(signedRequest({ invalid: true }))).status).toBe(400)
    const events = Array.from({ length: 1001 }, (_, index) => ({
      ...validEvent,
      id: `event-${index}`,
    }))
    expect((await callPost(signedRequest(events))).status).toBe(400)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies before loading the credential or enqueueing', async () => {
    const oversizedRequest = request('[]', 'irrelevant')
    oversizedRequest.headers.set('content-length', String(WEBHOOK_MAX_BODY_BYTES + 1))

    expect((await callPost(oversizedRequest)).status).toBe(413)
    expect(mockVerifierTokens).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('returns 503 when durable acceptance fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue unavailable'))
    expect((await callPost(signedRequest([validEvent]))).status).toBe(503)
  })
})
