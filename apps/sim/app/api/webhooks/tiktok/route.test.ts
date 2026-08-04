/**
 * @vitest-environment node
 */

import crypto from 'node:crypto'
import { requestUtilsMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchResolvedWebhookTarget, mockFindWebhooksByRoutingKey, mockRelease } = vi.hoisted(
  () => ({
    mockDispatchResolvedWebhookTarget: vi.fn(),
    mockFindWebhooksByRoutingKey: vi.fn(),
    mockRelease: vi.fn(),
  })
)

vi.mock('@/lib/webhooks/processor', () => ({
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
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

import { POST } from '@/app/api/webhooks/tiktok/route'

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
    vi.clearAllMocks()
    setEnv({ TIKTOK_CLIENT_ID: 'client-key', TIKTOK_CLIENT_SECRET: 'client-secret' })
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
    mockFindWebhooksByRoutingKey.mockResolvedValue([])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({ outcome: 'queued', reason: 'queued' })
  })

  afterAll(() => {
    resetEnvMock()
    requestUtilsMockFns.mockGenerateRequestId.mockReset()
  })

  it('routes a verified delivery by user_openid on the TikTok provider', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('webhook-1')])

    const response = await POST(signedRequest({ userOpenId: 'user-open-id' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledWith('user-open-id', 'request-1', 'tiktok')
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'webhook-1' }),
      expect.objectContaining({ id: 'workflow-webhook-1' }),
      expect.objectContaining({ user_openid: 'user-open-id' }),
      expect.any(NextRequest),
      expect.objectContaining({
        requestId: 'request-1',
        triggerTimestampMs: 1_725_000_000_000,
      })
    )
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('acknowledges a verified delivery when no workflow targets match', async () => {
    const response = await POST(signedRequest())

    expect(response.status).toBe(200)
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('dispatches matching workflows sequentially', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('webhook-1'), target('webhook-2')])
    const order: string[] = []
    mockDispatchResolvedWebhookTarget.mockImplementation(async (webhook: { id: string }) => {
      order.push(`start:${webhook.id}`)
      await Promise.resolve()
      order.push(`end:${webhook.id}`)
      return { outcome: 'queued', reason: 'queued' }
    })

    const response = await POST(signedRequest())

    expect(response.status).toBe(200)
    expect(order).toEqual(['start:webhook-1', 'end:webhook-1', 'start:webhook-2', 'end:webhook-2'])
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

  it('returns 503 when target lookup fails', async () => {
    mockFindWebhooksByRoutingKey.mockRejectedValue(new Error('database unavailable'))

    const response = await POST(signedRequest())

    expect(response.status).toBe(503)
    expect(mockRelease).toHaveBeenCalledOnce()
  })

  it('rejects a signed delivery for a different TikTok app', async () => {
    const response = await POST(signedRequest({ clientKey: 'other-client-key' }))

    expect(response.status).toBe(401)
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })
})
