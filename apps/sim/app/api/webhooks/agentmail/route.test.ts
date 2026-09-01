/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockTryAdmit, mockRelease, mockEq, mockExecuteInboxTask } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockTryAdmit: vi.fn(),
  mockRelease: vi.fn(),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  mockExecuteInboxTask: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: mockEq,
  gt: vi.fn((left: unknown, right: unknown) => ({ gt: [left, right] })),
  ne: vi.fn((left: unknown, right: unknown) => ({ ne: [left, right] })),
  sql: Object.assign((strings: TemplateStringsArray) => ({ strings }), {
    raw: (value: string) => ({ value }),
  }),
}))

vi.mock('svix', () => ({
  Webhook: class {
    private readonly secret: string
    constructor(secret: string) {
      this.secret = secret
    }
    verify(payload: string, headers: Record<string, string>) {
      return mockVerify(this.secret, payload, headers)
    }
  },
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: () => new Response(null, { status: 429 }),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceInboxAccess: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
}))

vi.mock('@/lib/mothership/inbox/executor', () => ({
  executeInboxTask: mockExecuteInboxTask,
}))

import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import { POST } from '@/app/api/webhooks/agentmail/route'

const TARGET_INBOX_ID = 'agent-b@agentmail.to'

const ROUTED_WORKSPACE = {
  id: 'workspace-b',
  inboxEnabled: true,
  inboxAddress: TARGET_INBOX_ID,
  webhookSecret: 'whsec_b',
}

function envelope(messageOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_type: 'message.received',
    message: {
      message_id: 'msg-1',
      thread_id: 'thread-1',
      inbox_id: TARGET_INBOX_ID,
      from: 'Member <member@example.com>',
      to: [TARGET_INBOX_ID],
      subject: 'Hello',
      text: 'Body text',
      created_at: '2026-08-08T00:00:00.000Z',
      ...messageOverrides,
    },
  })
}

function webhookRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://sim.ai/api/webhooks/agentmail', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_1',
      'svix-timestamp': '1786000000',
      'svix-signature': 'v1,AAAA',
      ...headers,
    },
    body,
  })
}

describe('POST /api/webhooks/agentmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    mockTryAdmit.mockReturnValue({ release: mockRelease })
    mockExecuteInboxTask.mockResolvedValue(undefined)
    mockVerify.mockImplementation(() => {
      throw new Error('signature mismatch')
    })
  })

  it('checks the signature against only the secret the payload routes to', async () => {
    queueTableRows(schemaMock.workspace, [ROUTED_WORKSPACE])

    const response = await POST(webhookRequest(envelope()))

    expect(response.status).toBe(401)
    expect(mockEq).toHaveBeenCalledWith(schemaMock.workspace.inboxProviderId, TARGET_INBOX_ID)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockVerify).toHaveBeenCalledWith('whsec_b', expect.any(String), expect.any(Object))
  })

  it('rejects a payload naming an inbox no workspace owns, without hashing it', async () => {
    queueTableRows(schemaMock.workspace, [])
    mockVerify.mockReturnValue(undefined)

    const response = await POST(
      webhookRequest(envelope({ inbox_id: 'agent-unknown@agentmail.to' }))
    )

    expect(response.status).toBe(401)
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith(
      schemaMock.workspace.inboxProviderId,
      'agent-unknown@agentmail.to'
    )
  })

  it('rejects an unroutable body before it reaches the database or the hash', async () => {
    const missingInboxId = await POST(
      webhookRequest(JSON.stringify({ message: { from: 'a@b.c' } }))
    )
    const malformedJson = await POST(webhookRequest('not json'))

    expect(missingInboxId.status).toBe(401)
    expect(malformedJson.status).toBe(401)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects an oversized body before parsing or hashing it', async () => {
    const oversized = WEBHOOK_MAX_BODY_BYTES + 1

    const response = await POST(webhookRequest(envelope(), { 'content-length': String(oversized) }))

    expect(response.status).toBe(413)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('sheds load at the admission gate before reading the body', async () => {
    mockTryAdmit.mockReturnValue(null)

    const response = await POST(webhookRequest(envelope()))

    expect(response.status).toBe(429)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('releases the admission ticket once the request settles', async () => {
    queueTableRows(schemaMock.workspace, [ROUTED_WORKSPACE])

    await POST(webhookRequest(envelope()))

    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('accepts a delivery whose signature verifies against the routed secret', async () => {
    mockVerify.mockReturnValue(undefined)
    queueTableRows(schemaMock.workspace, [ROUTED_WORKSPACE])
    queueTableRows(schemaMock.mothershipInboxAllowedSender, [{ id: 'allowed-1' }])

    const response = await POST(webhookRequest(envelope()))

    expect(response.status).toBe(200)
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: ROUTED_WORKSPACE.id, status: 'received' })
    )
  })
})
