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
  mockShouldSkip,
} = vi.hoisted(() => ({
  mockParseWebhookBody: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockCheckWebhookPreprocessing: vi.fn(),
  mockQueueWebhookExecution: vi.fn(),
  mockBlockExistsInDeployment: vi.fn(),
  mockShouldSkip: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: vi.fn() }),
  admissionRejectedResponse: () => new Response(null, { status: 503 }),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { SLACK_SIGNING_SECRET: 'test-secret' },
}))

vi.mock('@/lib/webhooks/processor', () => ({
  parseWebhookBody: mockParseWebhookBody,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  checkWebhookPreprocessing: mockCheckWebhookPreprocessing,
  queueWebhookExecution: mockQueueWebhookExecution,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: () => null,
  verifySlackRequestSignature: () => null,
  shouldSkipSlackTriggerEvent: mockShouldSkip,
  resolveSlackEventKey: () => null,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  blockExistsInDeployment: mockBlockExistsInDeployment,
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
  mockCheckWebhookPreprocessing.mockResolvedValue({
    actorUserId: 'u1',
    executionId: 'e1',
    correlation: {},
  })
  mockBlockExistsInDeployment.mockResolvedValue(true)
  await POST(makeRequest())
}

const messageBody = {
  team_id: 'T1',
  api_app_id: 'A1',
  event: { type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.1' },
}

describe('Slack app webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindWebhooksByRoutingKey.mockResolvedValue([webhook('wh1')])
  })

  it('queues execution when the shared filter does not skip', async () => {
    mockShouldSkip.mockReturnValue(false)
    await run(messageBody)
    expect(mockQueueWebhookExecution).toHaveBeenCalledTimes(1)
  })

  it('does not queue when the shared filter skips the event', async () => {
    mockShouldSkip.mockReturnValue(true)
    await run(messageBody)
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
  })

  it('routes via Slack Connect authorizations and dedups overlapping webhooks', async () => {
    mockShouldSkip.mockReturnValue(false)
    // Two candidate teams (outer + authorization) that resolve to overlapping webhooks.
    mockFindWebhooksByRoutingKey.mockImplementation(async (teamId: string) =>
      teamId === 'T1' ? [webhook('wh1')] : [webhook('wh1'), webhook('wh2')]
    )
    await run({
      ...messageBody,
      authorizations: [{ team_id: 'T2' }],
    })
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledTimes(2)
    // wh1 (in both) is queued once, wh2 once — dedup by webhook id.
    expect(mockQueueWebhookExecution).toHaveBeenCalledTimes(2)
  })

  it('returns 200 with no team_id', async () => {
    mockShouldSkip.mockReturnValue(false)
    await run({ event: { type: 'message' } })
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
  })

  it('routes an interaction payload by payload.team.id', async () => {
    mockShouldSkip.mockReturnValue(false)
    await run({
      type: 'block_actions',
      api_app_id: 'A1',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'approve_btn' }],
    })
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledWith('T1', expect.anything())
    expect(mockQueueWebhookExecution).toHaveBeenCalledTimes(1)
  })

  it('fails closed on an interaction missing payload.team.id (never routes on user.team_id)', async () => {
    mockShouldSkip.mockReturnValue(false)
    await run({
      type: 'block_actions',
      api_app_id: 'A1',
      user: { id: 'U1', team_id: 'T_OTHER' },
      actions: [{ action_id: 'approve_btn' }],
    })
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
    expect(mockQueueWebhookExecution).not.toHaveBeenCalled()
  })
})
