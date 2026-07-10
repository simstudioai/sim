/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseWebhookBody,
  mockFindWebhooksByRoutingKey,
  mockCheckWebhookPreprocessing,
  mockQueueWebhookExecution,
  mockBlockExistsInDeployment,
  mockGetSlackBotCredential,
  mockHandleChallenge,
  mockVerifySignature,
  mockShouldSkip,
} = vi.hoisted(() => ({
  mockParseWebhookBody: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockCheckWebhookPreprocessing: vi.fn(),
  mockQueueWebhookExecution: vi.fn(),
  mockBlockExistsInDeployment: vi.fn(),
  mockGetSlackBotCredential: vi.fn(),
  mockHandleChallenge: vi.fn(),
  mockVerifySignature: vi.fn(),
  mockShouldSkip: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: vi.fn() }),
  admissionRejectedResponse: () => new Response(null, { status: 503 }),
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getSlackBotCredential: mockGetSlackBotCredential,
}))

vi.mock('@/lib/webhooks/processor', () => ({
  parseWebhookBody: mockParseWebhookBody,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  checkWebhookPreprocessing: mockCheckWebhookPreprocessing,
  queueWebhookExecution: mockQueueWebhookExecution,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: mockHandleChallenge,
  verifySlackRequestSignature: mockVerifySignature,
  shouldSkipSlackTriggerEvent: mockShouldSkip,
  resolveSlackEventKey: () => null,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  blockExistsInDeployment: mockBlockExistsInDeployment,
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
    mockShouldSkip.mockReturnValue(false)
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
    mockCheckWebhookPreprocessing.mockResolvedValue({
      actorUserId: 'u1',
      executionId: 'e1',
      correlation: {},
    })
    mockBlockExistsInDeployment.mockResolvedValue(true)
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
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
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
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
  })

  it('fans out by credential id (provider slack) and queues when not skipped', async () => {
    await POST(makeRequest(), context)
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledWith(
      CREDENTIAL_ID,
      expect.any(String),
      'slack'
    )
    expect(mockQueueWebhookExecution).toHaveBeenCalledTimes(1)
  })

  it('does not queue when the shared filter skips the event', async () => {
    mockShouldSkip.mockReturnValue(true)
    await POST(makeRequest(), context)
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
  })
})
