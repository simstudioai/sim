/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  validateWorkspaceAccess: vi.fn(),
  getPublicWorkflowLog: vi.fn(),
  getUserLimits: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  /**
   * Mirrors the real `capabilityGovernedUserId`: a workspace key reports its
   * creator's `userId` too, so `keyType` — not the presence of a user — is what
   * decides whether a permission group governs the caller.
   */
  capabilityGovernedUserId: (rateLimit: { keyType?: string; userId?: string }) =>
    rateLimit.keyType === 'personal' ? (rateLimit.userId ?? null) : null,
  checkRateLimit: mocks.checkRateLimit,
  createRateLimitResponse: () => NextResponse.json({ error: 'Rate limit' }, { status: 429 }),
  validateWorkspaceAccess: mocks.validateWorkspaceAccess,
}))

vi.mock('@/lib/logs/public-queries', () => ({
  getPublicWorkflowLog: mocks.getPublicWorkflowLog,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: mocks.getUserLimits,
  createApiResponse: <T, L>(data: T, limits: L) => ({ body: { ...data, limits }, headers: {} }),
}))

/**
 * Overrides the global stub, whose empty `subBlocks` would let the sanitizer
 * no-op and make this suite pass against an unsanitized route.
 */
vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Gmail',
    subBlocks: [
      { id: 'credential', type: 'oauth-input' },
      { id: 'apiKey', type: 'short-input', password: true },
      { id: 'envApiKey', type: 'short-input', password: true },
      { id: 'subject', type: 'short-input' },
    ],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => []),
  getLatestBlock: vi.fn(() => undefined),
  getBlockRegistry: vi.fn(() => ({})),
  getBlockByToolName: vi.fn(() => undefined),
}))

import { GET } from '@/app/api/v1/logs/executions/[executionId]/route'

const rateLimit = {
  allowed: true,
  userId: 'user-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-11T00:00:00Z'),
}

function snapshot() {
  return {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'gmail',
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'credential-row-id' },
          apiKey: { id: 'apiKey', type: 'short-input', value: 'literal-secret-value' },
          envApiKey: { id: 'envApiKey', type: 'short-input', value: '{{GMAIL_API_KEY}}' },
          subject: { id: 'subject', type: 'short-input', value: 'Weekly digest' },
        },
      },
    },
    edges: [],
  }
}

function requestFor(executionId: string) {
  return {
    request: new NextRequest(`http://localhost:3000/api/v1/logs/executions/${executionId}`),
    context: { params: Promise.resolve({ executionId }) },
  }
}

describe('GET /api/v1/logs/executions/[executionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockResolvedValue(rateLimit)
    mocks.validateWorkspaceAccess.mockResolvedValue(null)
    mocks.getUserLimits.mockResolvedValue({ usage: { plan: 'free' } })
    mocks.getPublicWorkflowLog.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      workflowState: snapshot(),
      trigger: 'api',
      startedAt: new Date('2026-08-11T00:00:00Z'),
      endedAt: new Date('2026-08-11T00:00:01Z'),
      totalDurationMs: 1000,
      costTotal: '0.01',
    })
  })

  it('redacts credentials from the snapshot while preserving env-var references', async () => {
    const { request, context } = requestFor('execution-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)

    const subBlocks = body.workflowState.blocks['block-1'].subBlocks
    expect(subBlocks.credential.value).toBeNull()
    expect(subBlocks.apiKey.value).toBeNull()
    expect(subBlocks.envApiKey.value).toBe('{{GMAIL_API_KEY}}')
    expect(subBlocks.subject.value).toBe('Weekly digest')
    expect(JSON.stringify(body)).not.toContain('literal-secret-value')
    expect(JSON.stringify(body)).not.toContain('credential-row-id')
  })

  it('keeps the surrounding response shape intact', async () => {
    const { request, context } = requestFor('execution-1')
    const body = await (await GET(request, context)).json()

    expect(body).toMatchObject({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      executionMetadata: {
        trigger: 'api',
        startedAt: '2026-08-11T00:00:00.000Z',
        endedAt: '2026-08-11T00:00:01.000Z',
        totalDurationMs: 1000,
        cost: { total: 0.01 },
      },
      limits: { usage: { plan: 'free' } },
    })
  })

  it('reports a missing snapshot as not found', async () => {
    mocks.getPublicWorkflowLog.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      workflowState: null,
      trigger: 'api',
      startedAt: new Date('2026-08-11T00:00:00Z'),
      endedAt: null,
      totalDurationMs: 1000,
      costTotal: null,
    })

    const { request, context } = requestFor('execution-1')
    const response = await GET(request, context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workflow state snapshot not found' })
  })
})
