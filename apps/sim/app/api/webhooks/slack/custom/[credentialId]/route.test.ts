/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseWebhookBody,
  mockFindWebhooksByRoutingKey,
  mockDispatchResolvedWebhookTarget,
  mockGetSlackBotCredential,
  mockHandleChallenge,
  mockVerifySignature,
} = vi.hoisted(() => ({
  mockParseWebhookBody: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockDispatchResolvedWebhookTarget: vi.fn(),
  mockGetSlackBotCredential: vi.fn(),
  mockHandleChallenge: vi.fn(),
  mockVerifySignature: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: vi.fn() }),
  admissionRejectedResponse: () => new Response(null, { status: 503 }),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  getSlackBotCredential: mockGetSlackBotCredential,
}))

vi.mock('@/lib/webhooks/processor', () => ({
  parseWebhookBody: mockParseWebhookBody,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: mockHandleChallenge,
  verifySlackRequestSignature: mockVerifySignature,
  resolveSlackEventKey: () => null,
}))

import { POST } from '@/app/api/webhooks/slack/custom/[credentialId]/route'

const CREDENTIAL_ID = 'cred-123'

function makeRequest() {
  return new Request('https://sim.test/api/webhooks/slack/custom/cred-123', {
    method: 'POST',
    headers: { 'x-slack-request-timestamp': '1700000000' },
  }) as unknown as import('next/server').NextRequest
}

const context = { params: Promise.resolve({ credentialId: CREDENTIAL_ID }) }

const messageBody = {
  team_id: 'T1',
  api_app_id: 'A1',
  event: { type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.1' },
}

function webhook(id: string) {
  return { webhook: { id, blockId: `blk-${id}`, providerConfig: {} }, workflow: { id: `wf-${id}` } }
}

describe('Slack custom-bot webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleChallenge.mockReturnValue(null)
    mockVerifySignature.mockReturnValue(null)
    mockParseWebhookBody.mockResolvedValue({
      body: messageBody,
      rawBody: JSON.stringify(messageBody),
    })
    mockGetSlackBotCredential.mockResolvedValue({
      signingSecret: 'sec',
      botToken: 'xoxb-x',
      teamId: 'T1',
    })
    mockFindWebhooksByRoutingKey.mockResolvedValue([webhook('wh1')])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'queued',
      response: new Response(null, { status: 200 }),
      reason: 'queued',
    })
  })

  it('echoes the url_verification challenge without loading the credential', async () => {
    mockHandleChallenge.mockReturnValue(new Response('ok', { status: 200 }))
    await POST(makeRequest(), context)
    expect(mockGetSlackBotCredential).not.toHaveBeenCalled()
    expect(mockVerifySignature).not.toHaveBeenCalled()
  })

  it('404s an unknown credential', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    const res = await POST(makeRequest(), context)
    expect(res.status).toBe(404)
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('404s an action-only bot credential without a signing secret', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      botToken: 'xoxb-x',
      teamId: 'T1',
    })

    const res = await POST(makeRequest(), context)

    expect(res.status).toBe(404)
    expect(mockVerifySignature).not.toHaveBeenCalled()
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })

  it('verifies with the credential signing secret and rejects a bad signature', async () => {
    mockVerifySignature.mockReturnValue(new Response(null, { status: 401 }))
    const res = await POST(makeRequest(), context)
    expect(mockVerifySignature).toHaveBeenCalledWith(
      'sec',
      expect.anything(),
      expect.any(String),
      expect.any(String)
    )
    expect(res.status).toBe(401)
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('fans out by credential id (provider slack) and dispatches each webhook', async () => {
    const res = await POST(makeRequest(), context)
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledWith(
      CREDENTIAL_ID,
      expect.any(String),
      'slack'
    )
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('still returns 200 when the dispatcher filters the event', async () => {
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'ignored',
      response: new Response(null, { status: 200 }),
      reason: 'filtered',
    })
    const res = await POST(makeRequest(), context)
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('returns 200 when every target permanently lacks its deployed trigger block', async () => {
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'ignored',
      response: new Response('Trigger block not found in deployment', { status: 404 }),
      reason: 'block-missing',
    })

    const res = await POST(makeRequest(), context)

    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('returns a retryable failure when another target fails beside a missing block', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([webhook('wh1'), webhook('wh2')])
    mockDispatchResolvedWebhookTarget
      .mockResolvedValueOnce({
        outcome: 'ignored',
        response: new Response('Trigger block not found in deployment', { status: 404 }),
        reason: 'block-missing',
      })
      .mockResolvedValueOnce({
        outcome: 'failed',
        response: new Response('Queue failed', { status: 500 }),
        reason: 'queue-failed',
      })

    const res = await POST(makeRequest(), context)

    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toBe('Queue failed')
  })

  it('returns the dispatch failure when no target is acknowledged', async () => {
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'failed',
      response: new Response('Preprocessing failed', { status: 500 }),
      reason: 'preprocessing',
    })

    const res = await POST(makeRequest(), context)

    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    await expect(res.text()).resolves.toBe('Preprocessing failed')
  })
})
