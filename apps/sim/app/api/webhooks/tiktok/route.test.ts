import crypto from 'node:crypto'
import { requestUtilsMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { admissionGateMock, admissionGateMockFns } from '@sim/testing/mocks/admission-gate.mock'
import {
  webhooksProcessorMock,
  webhooksProcessorMockFns,
} from '@sim/testing/mocks/webhooks-processor.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/core/admission/gate', () => admissionGateMock)

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler:
    (handler: (request: NextRequest) => Promise<Response>) => (request: NextRequest) =>
      handler(request),
}))

import { POST } from '@/app/api/webhooks/tiktok/route'

admissionGateMockFns.mockAdmissionRejectedResponse.mockImplementation(
  () => new Response(null, { status: 503 })
)

const mockDispatchResolvedWebhookTarget = webhooksProcessorMockFns.mockDispatchResolvedWebhookTarget
const mockFindWebhooksByRoutingKey = webhooksProcessorMockFns.mockFindWebhooksByRoutingKey

const target = (id: string) => ({
  webhook: { id, path: null, provider: 'tiktok' },
  workflow: { id: `workflow-${id}` },
})

function signedRequest(overrides?: { clientKey?: string; userOpenId?: string }): NextRequest {
  const body = JSON.stringify({
    client_key: overrides?.clientKey ?? 'client-key',
    event: 'post.publish.complete',
    create_time: 1_725_000_000,
    user_openid: overrides?.userOpenId ?? 'act.user',
    content: '{"publish_id":"publish-1"}',
  })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = crypto
    .createHmac('sha256', 'client-secret')
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex')

  return new NextRequest('http://localhost/api/webhooks/tiktok', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'TikTok-Signature': `t=${timestamp},s=${signature}`,
    },
    body,
  })
}

describe('TikTok app webhook route', () => {
  beforeEach(() => {
    setEnv({ TIKTOK_CLIENT_ID: 'client-key', TIKTOK_CLIENT_SECRET: 'client-secret' })
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
    mockFindWebhooksByRoutingKey.mockResolvedValue([])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({ outcome: 'queued', reason: 'queued' })
  })

  afterAll(() => {
    resetEnvMock()
    requestUtilsMockFns.mockGenerateRequestId.mockReset()
  })

  it('returns a retryable response when a target cannot be dispatched', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('webhook-1')])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'failed',
      reason: 'queue-failed',
    })

    const response = await POST(signedRequest())

    expect(response.status).toBe(503)
  })

  it('rejects a signed delivery for a different TikTok app', async () => {
    const response = await POST(signedRequest({ clientKey: 'other-client-key' }))

    expect(response.status).toBe(401)
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })
})
