/**
 * @vitest-environment node
 */

import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueTikTokWebhookIngress, mockRelease } = vi.hoisted(() => ({
  mockEnqueueTikTokWebhookIngress: vi.fn(),
  mockRelease: vi.fn(),
}))

vi.mock('@/background/tiktok-webhook-ingress', () => ({
  enqueueTikTokWebhookIngress: mockEnqueueTikTokWebhookIngress,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  admissionRejectedResponse: vi.fn(() => new Response(null, { status: 503 })),
  tryAdmit: vi.fn(() => ({ release: mockRelease })),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    TIKTOK_CLIENT_ID: 'client-key',
    TIKTOK_CLIENT_SECRET: 'client-secret',
  },
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler:
    (handler: (request: NextRequest) => Promise<Response>) => (request: NextRequest) =>
      handler(request),
}))

import { POST } from '@/app/api/webhooks/tiktok/route'

function signedRequest(overrides?: { clientKey?: string }): NextRequest {
  const body = JSON.stringify({
    client_key: overrides?.clientKey ?? 'client-key',
    event: 'post.publish.complete',
    create_time: 1_725_000_000,
    user_openid: 'act.user',
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

describe('TikTok webhook ingress route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueueTikTokWebhookIngress.mockResolvedValue('ingress-job-1')
  })

  it('returns 200 only after the verified delivery is accepted by the job queue', async () => {
    const response = await POST(signedRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockEnqueueTikTokWebhookIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          client_key: 'client-key',
          user_openid: 'act.user',
        }),
        requestId: 'request-1',
      })
    )
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('returns 503 when durable acceptance fails so TikTok retries', async () => {
    mockEnqueueTikTokWebhookIngress.mockRejectedValue(new Error('queue unavailable'))

    const response = await POST(signedRequest())

    expect(response.status).toBe(503)
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('rejects a signed delivery for a different TikTok app', async () => {
    const response = await POST(signedRequest({ clientKey: 'other-client-key' }))

    expect(response.status).toBe(401)
    expect(mockEnqueueTikTokWebhookIngress).not.toHaveBeenCalled()
  })
})
