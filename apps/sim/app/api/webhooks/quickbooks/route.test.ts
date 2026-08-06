/** @vitest-environment node */

import crypto from 'node:crypto'
import { requestUtilsMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue, mockRelease } = vi.hoisted(() => ({
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
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler:
    (handler: (request: NextRequest) => Promise<Response>) => (request: NextRequest) =>
      handler(request),
}))

import { POST } from '@/app/api/webhooks/quickbooks/route'

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
  return new NextRequest('http://localhost/api/webhooks/quickbooks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'intuit-signature': signature } : {}),
    },
    body,
  })
}

function signedRequest(value: unknown): NextRequest {
  const body = JSON.stringify(value)
  const signature = crypto.createHmac('sha256', 'verifier').update(body).digest('base64')
  return request(body, signature)
}

describe('QuickBooks webhook ingress route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({ QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: 'verifier' })
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
    mockEnqueue.mockResolvedValue('job-1')
  })
  afterAll(() => {
    resetEnvMock()
    requestUtilsMockFns.mockGenerateRequestId.mockReset()
  })

  it('accepts a signed multi-company batch only after durable enqueue', async () => {
    const response = await POST(
      signedRequest([validEvent, { ...validEvent, id: 'event-2', intuitaccountid: '789' }])
    )
    expect(response.status).toBe(200)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [validEvent, { ...validEvent, id: 'event-2', intuitaccountid: '789' }],
        requestId: 'request-1',
      })
    )
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('rejects missing signatures and malformed signed payloads before enqueue', async () => {
    expect((await POST(request(JSON.stringify([validEvent])))).status).toBe(401)
    expect((await POST(signedRequest({ invalid: true }))).status).toBe(400)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rejects batches over the 1,000 event bound', async () => {
    const events = Array.from({ length: 1001 }, (_, index) => ({
      ...validEvent,
      id: `event-${index}`,
    }))
    expect((await POST(signedRequest(events))).status).toBe(400)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('returns 503 when durable acceptance fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue unavailable'))
    expect((await POST(signedRequest([validEvent]))).status).toBe(503)
  })
})
