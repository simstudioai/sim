/**
 * @vitest-environment node
 *
 * `logs.trace_spans` and `logs.cost` are PROJECTIONS, not gates — a group
 * withholds those fields from the response rather than refusing the read, which
 * is why every v1 logs route correctly declares `capability: 'none'`. The
 * internal/v2 detail path applies them in `readLogDetail`; the v1 routes built
 * their own bodies and applied nothing, so `?details=full&includeTraceSpans=true`
 * still handed a governed member the spans and the spend.
 *
 * These run the real routes against the real `resolveLogFieldProjection` — the
 * same helper `readLogDetail` resolves its flags through — so they fail if
 * either surface stops projecting.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateV1Request,
  mockGetUserEntityPermissions,
  mockGetWorkspaceBillingSettings,
  mockListPublicWorkflowLogs,
  mockGetPublicWorkflowLog,
  mockMaterialize,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockListPublicWorkflowLogs: vi.fn(),
  mockGetPublicWorkflowLog: vi.fn(),
  mockMaterialize: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/app/api/v1/auth', () => ({ authenticateV1Request: mockAuthenticateV1Request }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
  getWorkspaceBilledAccountUserId: vi.fn(async () => 'billed-user'),
  getWorkspaceOrganizationId: vi.fn(async () => null),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(async () => null),
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription() {
      return Promise.resolve({ allowed: true, remaining: 100, resetAt: new Date() })
    }
  },
  getRateLimit: () => ({ maxTokens: 200 }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  buildRateLimitHeaders: () => ({}),
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: () => null,
}))
vi.mock('@/lib/logs/public-queries', () => ({
  listPublicWorkflowLogs: mockListPublicWorkflowLogs,
  getPublicWorkflowLog: mockGetPublicWorkflowLog,
  decodePublicLogCursor: vi.fn(),
}))
vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: mockMaterialize,
}))
vi.mock('@/lib/logs/snapshot-sanitizer', () => ({
  sanitizeExecutionSnapshotState: (state: unknown) => state,
}))
vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn(async () => ({})),
  createApiResponse: (body: unknown) => ({ body, headers: {} }),
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as getLogDetail } from '@/app/api/v1/logs/[id]/route'
import { GET as getExecution } from '@/app/api/v1/logs/executions/[executionId]/route'
import { GET as listLogs } from '@/app/api/v1/logs/route'

const USER_ID = 'user-1'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const LOG_ID = 'log-1'

const EXECUTION_DATA = {
  finalOutput: { answer: 'a customer address' },
  workflowInput: { question: 'who?' },
  blockInput: { prompt: 'who?' },
  blockExecutions: [{ blockId: 'b1', cost: { total: 0.2 }, tokens: { total: 90 } }],
  traceSpans: [
    {
      id: 's1',
      name: 'agent',
      cost: { total: 0.5 },
      tokens: { total: 120 },
      children: [{ id: 's2', name: 'tool', cost: { total: 0.1 } }],
    },
  ],
}

const LOG_ROW = {
  id: LOG_ID,
  workflowId: 'wf-1',
  workspaceId: WORKSPACE_ID,
  executionId: 'exec-1',
  deploymentVersionId: null,
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  endedAt: new Date('2026-01-01T00:00:01.000Z'),
  createdAt: new Date('2026-01-01T00:00:01.000Z'),
  workflowState: { blocks: {} },
  totalDurationMs: 1000,
  costTotal: '0.75',
  files: null,
  executionData: EXECUTION_DATA,
  workflowName: 'wf',
  workflowDescription: null,
  workflowFolderId: null,
  workflowUserId: USER_ID,
  workflowWorkspaceId: WORKSPACE_ID,
  workflowCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
  workflowUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function personalKey() {
  return {
    authenticated: true,
    userId: USER_ID,
    keyType: 'personal' as const,
    principal: { kind: 'personal_api_key' as const, userId: USER_ID, keyId: 'key-1' },
  }
}

/** A workspace key authorizes as the workspace: its creator's group is nobody's. */
function workspaceKey() {
  return {
    authenticated: true,
    userId: 'key-creator',
    workspaceId: WORKSPACE_ID,
    keyType: 'workspace' as const,
    principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-2' },
  }
}

function governedBy(overrides: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG>) {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    ...overrides,
  })
}

function apiRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-api-key': 'sim_test' },
  })
}

function listFull() {
  return listLogs(
    apiRequest(
      `/api/v1/logs?workspaceId=${WORKSPACE_ID}&details=full&includeTraceSpans=true&includeFinalOutput=true`
    )
  )
}

function readExecution() {
  return getExecution(apiRequest('/api/v1/logs/executions/exec-1'), {
    params: Promise.resolve({ executionId: 'exec-1' }),
  })
}

function readDetail() {
  return getLogDetail(apiRequest(`/api/v1/logs/${LOG_ID}`), {
    params: Promise.resolve({ id: LOG_ID }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPermissionGroupScopeMock()
  mockAuthenticateV1Request.mockResolvedValue(personalKey())
  mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: true })
  mockListPublicWorkflowLogs.mockResolvedValue({ data: [LOG_ROW], nextCursor: null })
  mockGetPublicWorkflowLog.mockResolvedValue(LOG_ROW)
  mockMaterialize.mockImplementation(async () => structuredClone(EXECUTION_DATA))
})

describe('GET /api/v1/logs?details=full', () => {
  it('withholds trace spans and the final output when the group hides them', async () => {
    governedBy({ hideTraceSpans: true })

    const body = await (await listFull()).json()
    const [log] = body.data

    expect(log).not.toHaveProperty('traceSpans')
    expect(log).not.toHaveProperty('finalOutput')
  })

  it('withholds the run cost when the group hides cost', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await listFull()).json()

    expect(body.data[0].cost).toBeNull()
  })

  it('strips spend from the spans it still returns when only cost is hidden', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await listFull()).json()
    const [span] = body.data[0].traceSpans

    expect(span.name).toBe('agent')
    expect(span).not.toHaveProperty('cost')
    expect(span).not.toHaveProperty('tokens')
    expect(span.children[0]).not.toHaveProperty('cost')
  })

  it('returns both when no group withholds them', async () => {
    const body = await (await listFull()).json()
    const [log] = body.data

    expect(log.cost).toEqual({ total: 0.75 })
    expect(log.traceSpans[0].cost).toEqual({ total: 0.5 })
    expect(log.finalOutput).toEqual(EXECUTION_DATA.finalOutput)
  })

  it('withholds nothing from a workspace API key, whose creator has no say', async () => {
    mockAuthenticateV1Request.mockResolvedValue(workspaceKey())
    governedBy({ hideTraceSpans: true, hideCostInfo: true })

    const body = await (await listFull()).json()
    const [log] = body.data

    expect(log.cost).toEqual({ total: 0.75 })
    expect(log.traceSpans).toHaveLength(1)
  })
})

describe('GET /api/v1/logs/[id]', () => {
  it('withholds the execution payloads when the group hides trace spans', async () => {
    governedBy({ hideTraceSpans: true })

    const body = await (await readDetail()).json()

    expect(body.data.executionData).not.toHaveProperty('traceSpans')
    expect(body.data.executionData).not.toHaveProperty('blockExecutions')
    expect(body.data.executionData).not.toHaveProperty('finalOutput')
    expect(body.data.executionData).not.toHaveProperty('workflowInput')
    expect(body.data.executionData).not.toHaveProperty('blockInput')
  })

  it('withholds the run cost and per-span spend when the group hides cost', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await readDetail()).json()

    expect(body.data.cost).toBeNull()
    expect(body.data.executionData.traceSpans[0]).not.toHaveProperty('cost')
    expect(body.data.executionData.blockExecutions[0]).not.toHaveProperty('tokens')
  })

  it('returns everything when no group withholds it', async () => {
    const body = await (await readDetail()).json()

    expect(body.data.cost).toEqual({ total: 0.75 })
    expect(body.data.executionData.traceSpans[0].cost).toEqual({ total: 0.5 })
    expect(body.data.executionData.finalOutput).toEqual(EXECUTION_DATA.finalOutput)
  })
})

describe('GET /api/v1/logs/executions/[executionId]', () => {
  it('withholds the run cost when the group hides cost', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await readExecution()).json()

    expect(body.executionMetadata.cost).toBeNull()
  })

  it('returns the run cost when no group withholds it', async () => {
    const body = await (await readExecution()).json()

    expect(body.executionMetadata.cost).toEqual({ total: 0.75 })
  })
})
