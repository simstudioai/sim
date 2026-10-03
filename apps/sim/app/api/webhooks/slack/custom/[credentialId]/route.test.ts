import { admissionGateMock, admissionGateMockFns } from '@sim/testing/mocks/admission-gate.mock'
import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import {
  webhooksProcessorMock,
  webhooksProcessorMockFns,
} from '@sim/testing/mocks/webhooks-processor.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHandleChallenge, mockVerifySignature, mockDispatchSearch } = vi.hoisted(() => ({
  mockHandleChallenge: vi.fn(),
  mockVerifySignature: vi.fn(),
  mockDispatchSearch: vi.fn(),
}))

vi.mock('@/lib/slack-search/dispatcher', () => ({ dispatchSlackSearch: mockDispatchSearch }))

vi.mock('@/lib/core/admission/gate', () => admissionGateMock)

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: mockHandleChallenge,
  verifySlackRequestSignature: mockVerifySignature,
  resolveSlackEventKey: () => null,
}))

import { POST } from '@/app/api/webhooks/slack/custom/[credentialId]/route'

const { mockParseWebhookBody, mockFindWebhooksByRoutingKey, mockDispatchResolvedWebhookTarget } =
  webhooksProcessorMockFns
const { mockGetSlackBotCredential } = authOAuthUtilsMockFns

admissionGateMockFns.mockAdmissionRejectedResponse.mockImplementation(
  () => new Response(null, { status: 503 })
)

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
    mockDispatchSearch.mockResolvedValue(undefined)
    mockHandleChallenge.mockReturnValue(null)
    mockVerifySignature.mockReturnValue(null)
    mockParseWebhookBody.mockResolvedValue({
      body: messageBody,
      rawBody: JSON.stringify(messageBody),
    })
    mockGetSlackBotCredential.mockResolvedValue({
      signingSecret: 'sec',
      credentialVersion: 'version',
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

  it('returns a retryable failure when Search enqueue fails beside a successful workflow', async () => {
    mockDispatchSearch.mockRejectedValue(new Error('Queue unavailable'))
    const response = await POST(makeRequest(), context)
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledOnce()
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
})
