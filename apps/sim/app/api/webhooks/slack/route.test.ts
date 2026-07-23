/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseWebhookBody, mockFindWebhooksByRoutingKey, mockDispatchResolvedWebhookTarget } =
  vi.hoisted(() => ({
    mockParseWebhookBody: vi.fn(),
    mockFindWebhooksByRoutingKey: vi.fn(),
    mockDispatchResolvedWebhookTarget: vi.fn(),
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
  handleSlackChallenge: () => null,
  verifySlackRequestSignature: () => null,
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
  await POST(makeRequest())
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
    mockFindWebhooksByRoutingKey.mockResolvedValue([webhook('wh1')])
    mockDispatchResolvedWebhookTarget.mockResolvedValue({
      outcome: 'queued',
      response: new Response(null, { status: 200 }),
      reason: 'queued',
    })
  })

  it('dispatches each webhook resolved for the event team', async () => {
    await run(messageBody)
    expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(1)
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
