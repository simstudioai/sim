/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseWebhookBody,
  mockFindWebhooksByRoutingKey,
  mockDispatchResolvedWebhookTarget,
  mockHandleSlackChallenge,
  mockVerifySlackRequestSignature,
} = vi.hoisted(() => ({
  mockParseWebhookBody: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockDispatchResolvedWebhookTarget: vi.fn(),
  mockHandleSlackChallenge: vi.fn(),
  mockVerifySlackRequestSignature: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: vi.fn() }),
  admissionRejectedResponse: () => new Response(null, { status: 503 }),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  parseWebhookBody: mockParseWebhookBody,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: mockHandleSlackChallenge,
  verifySlackRequestSignature: mockVerifySlackRequestSignature,
  resolveSlackEventKey: () => null,
}))

import { POST } from '@/app/api/webhooks/slack/route'

function makeRequest() {
  return new Request('https://sim.test/api/webhooks/slack', {
    method: 'POST',
    headers: { 'x-slack-request-timestamp': '1700000000' },
  }) as unknown as import('next/server').NextRequest
}

function webhook(id: string) {
  return { webhook: { id, blockId: `blk-${id}`, providerConfig: {} }, workflow: { id: `wf-${id}` } }
}

async function run(body: Record<string, unknown>) {
  mockParseWebhookBody.mockResolvedValue({ body, rawBody: JSON.stringify(body) })
  return POST(makeRequest())
}

const messageBody = {
  team_id: 'T1',
  api_app_id: 'A1',
  event: { type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.1' },
}

describe('Slack app webhook route', () => {
  afterAll(() => {
    resetEnvMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({ SLACK_SIGNING_SECRET: 'test-secret' })
    mockHandleSlackChallenge.mockReturnValue(null)
    mockVerifySlackRequestSignature.mockReturnValue(null)
    mockFindWebhooksByRoutingKey.mockResolvedValue([webhook('wh1')])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'queued',
      response: new Response(null, { status: 200 }),
      reason: 'queued',
    })
  })

  it('dispatches each webhook resolved for the event team', async () => {
    await run(messageBody)
    expect(mockVerifySlackRequestSignature).toHaveBeenCalledWith(
      'test-secret',
      expect.anything(),
      JSON.stringify(messageBody),
      expect.any(String)
    )
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
  })

  it('rejects a verification challenge when the native app is not configured', async () => {
    setEnv({ SLACK_SIGNING_SECRET: undefined })
    mockHandleSlackChallenge.mockReturnValue(new Response('challenge', { status: 200 }))

    const response = await run({ type: 'url_verification', challenge: 'challenge' })

    expect(response.status).toBe(500)
    expect(mockVerifySlackRequestSignature).not.toHaveBeenCalled()
    expect(mockHandleSlackChallenge).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only native signing secret as unconfigured', async () => {
    setEnv({ SLACK_SIGNING_SECRET: '   ' })

    const response = await run(messageBody)

    expect(response.status).toBe(500)
    expect(mockVerifySlackRequestSignature).not.toHaveBeenCalled()
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })

  it('verifies a signed request before answering the verification challenge', async () => {
    const body = { type: 'url_verification', challenge: 'challenge' }
    mockHandleSlackChallenge.mockReturnValue(new Response('challenge', { status: 200 }))

    const response = await run(body)

    expect(mockVerifySlackRequestSignature).toHaveBeenCalledWith(
      'test-secret',
      expect.anything(),
      JSON.stringify(body),
      expect.any(String)
    )
    expect(mockHandleSlackChallenge).toHaveBeenCalledWith(body)
    expect(response.status).toBe(200)
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })

  it('does not answer a verification challenge with an invalid signature', async () => {
    mockVerifySlackRequestSignature.mockReturnValue(new Response(null, { status: 401 }))
    mockHandleSlackChallenge.mockReturnValue(new Response('challenge', { status: 200 }))

    const response = await run({ type: 'url_verification', challenge: 'challenge' })

    expect(response.status).toBe(401)
    expect(mockHandleSlackChallenge).not.toHaveBeenCalled()
  })

  it('continues cleanly when the dispatcher filters the event', async () => {
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'ignored',
      response: new Response(null, { status: 200 }),
      reason: 'filtered',
    })
    await run(messageBody)
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable failure when no target queues', async () => {
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'failed',
      response: new Response(null, { status: 500 }),
      reason: 'queue-failed',
    })

    const response = await run(messageBody)

    expect(response.status).toBe(500)
  })

  it('routes via Slack Connect authorizations and dedups overlapping webhooks', async () => {
    // Two candidate teams (outer + authorization) that resolve to overlapping webhooks.
    mockFindWebhooksByRoutingKey.mockImplementation(async (teamId: string) =>
      teamId === 'T1' ? [webhook('wh1')] : [webhook('wh1'), webhook('wh2')]
    )
    await run({
      ...messageBody,
      authorizations: [{ team_id: 'T2' }],
    })
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledTimes(2)
    // wh1 (in both) is dispatched once, wh2 once — dedup by webhook id.
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(2)
  })

  it('returns 200 with no team_id', async () => {
    await run({ event: { type: 'message' } })
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })

  it('routes an interaction payload by payload.team.id', async () => {
    await run({
      type: 'block_actions',
      api_app_id: 'A1',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'approve_btn' }],
    })
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledWith('T1', expect.anything())
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
  })

  it('fails closed on an interaction missing payload.team.id (never routes on user.team_id)', async () => {
    await run({
      type: 'block_actions',
      api_app_id: 'A1',
      user: { id: 'U1', team_id: 'T_OTHER' },
      actions: [{ action_id: 'approve_btn' }],
    })
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
    expect(mockDispatchResolvedWebhookTarget).not.toHaveBeenCalled()
  })
})
