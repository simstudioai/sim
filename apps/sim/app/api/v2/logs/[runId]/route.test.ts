/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/logs/application/get-public-log', () => ({
  getPublicLog: { operation: { id: 'logs.read_detail' }, execute: mocks.execute },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/logs/[runId]/route'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const log = {
  executionId: 'run-1',
  workflowId: 'workflow-1',
  deploymentVersionId: 'deployment-1',
  status: 'completed',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-08-06T00:00:00Z'),
  endedAt: new Date('2026-08-06T00:00:01Z'),
  totalDurationMs: 1000,
  files: null,
  workflowName: 'Support Agent',
  workflowDescription: null,
  workflowOwnerEmail: 'owner@example.com',
  workflowWorkspaceId: 'workspace-1',
  workflowCreatedAt: new Date('2026-01-01T00:00:00Z'),
  workflowUpdatedAt: new Date('2026-01-02T00:00:00Z'),
  workflowArchivedAt: null,
  workflowState: { blocks: {}, edges: [] },
  costTotal: '0.01',
  createdAt: new Date('2026-08-06T00:00:00Z'),
}

describe('GET /api/v2/logs/[runId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      log,
      workflowFolderPath: '/agents',
      executionData: {
        traceSpans: [],
        finalOutput: { ok: true },
        workflowInput: { ticketId: 'T-1' },
      },
      costLedger: {
        total: 0.01,
        items: [{ category: 'model', description: 'gpt-5', cost: 0.01 }],
      },
    })
  })

  it('uses runId as the sole asserted identity', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/logs/run-1')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      runId: 'run-1',
      workflow: { folderPath: '/agents', ownerEmail: 'owner@example.com' },
      finalOutput: { ok: true },
    })
    expect(body.data).not.toHaveProperty('executionData')
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { runId: 'run-1' },
      request,
    })
  })

  it('serves a run whose persisted status is paused', async () => {
    mocks.execute.mockResolvedValue({
      log: { ...log, status: 'paused' },
      workflowFolderPath: '/agents',
      executionData: { traceSpans: [], finalOutput: null },
    })

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ runId: 'run-1', status: 'paused' })
  })

  it('itemizes the run cost alongside its total', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect((await response.json()).data.cost).toEqual({
      total: 0.01,
      items: [{ category: 'model', description: 'gpt-5', cost: 0.01 }],
    })
  })

  /**
   * `null` and `[]` are different answers: `null` means no ledger exists for the
   * run at all, where `[]` would claim a ledger that itemizes to nothing.
   */
  it('reports a missing ledger as null rather than as an empty item list', async () => {
    mocks.execute.mockResolvedValueOnce({
      log,
      workflowFolderPath: '/agents',
      executionData: { traceSpans: [], finalOutput: null },
      costLedger: null,
    })

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect((await response.json()).data.cost).toEqual({ total: 0.01, items: null })
  })

  it('returns the input the run was triggered with', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect((await response.json()).data.workflowInput).toEqual({ ticketId: 'T-1' })
  })

  it('reports a run that recorded no input as null rather than omitting the field', async () => {
    mocks.execute.mockResolvedValueOnce({
      log,
      workflowFolderPath: '/agents',
      executionData: { traceSpans: [], finalOutput: null },
      costLedger: null,
    })

    const body = await (
      await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
        params: Promise.resolve({ runId: 'run-1' }),
      })
    ).json()

    expect(body.data).toHaveProperty('workflowInput')
    expect(body.data.workflowInput).toBeNull()
  })

  it('conceals canonical workspace authorization as log not-found', async () => {
    mocks.execute.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Log not found' },
    })
  })

  it('hides unexpected materialization errors', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('storage key details'))

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/logs/run-1'), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
