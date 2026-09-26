/**
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
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing/mocks/permission-group-scope.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { traceStoreMock, traceStoreMockFns } from '@sim/testing/mocks/trace-store.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import {
  v1PersonalKeyCredential,
  v1RateLimitContextModuleMock,
  v1RateLimiterModuleMock,
  v1SubscriptionModuleMock,
  v1WorkspaceKeyCredential,
} from '@sim/testing/mocks/v1-route.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateV1Request, mockListPublicWorkflowLogs, mockGetPublicWorkflowLog } =
  vi.hoisted(() => ({
    mockAuthenticateV1Request: vi.fn(),
    mockListPublicWorkflowLogs: vi.fn(),
    mockGetPublicWorkflowLog: vi.fn(),
  }))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/app/api/v1/auth', () => ({ authenticateV1Request: mockAuthenticateV1Request }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/billing/core/subscription', () => v1SubscriptionModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v1RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/logs/public-queries', () => ({
  listPublicWorkflowLogs: mockListPublicWorkflowLogs,
  getPublicWorkflowLog: mockGetPublicWorkflowLog,
  decodePublicLogCursor: vi.fn(),
}))
vi.mock('@/lib/logs/execution/trace-store', () => traceStoreMock)
vi.mock('@/lib/logs/snapshot-sanitizer', () => ({
  sanitizeExecutionSnapshotState: (state: unknown) => state,
}))
vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as getLogDetail } from '@/app/api/v1/logs/[id]/route'
import { GET as getExecution } from '@/app/api/v1/logs/executions/[executionId]/route'
import { GET as listLogs } from '@/app/api/v1/logs/route'

const { mockGetWorkspaceBillingSettings } = workspacesUtilsMockFns
workspacesUtilsMockFns.mockGetWorkspaceBilledAccountUserId.mockImplementation(
  async () => 'billed-user'
)
workspacesUtilsMockFns.mockGetWorkspaceOrganizationId.mockImplementation(async () => null)
const { mockMaterializeExecutionDataForDisplay: mockMaterialize } = traceStoreMockFns

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
v1LogsMetaMockFns.mockGetUserLimits.mockResolvedValue({
  usage: { currentPeriodCost: 4.25, limit: 50, plan: 'pro', isExceeded: false },
})

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

function governedBy(overrides: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG>) {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    ...overrides,
  })
}

function apiRequest(path: string) {
  return createMockRequest({ url: `http://localhost${path}`, headers: { 'x-api-key': 'sim_test' } })
}

function listFull() {
  return listLogs(
    apiRequest(
      `/api/v1/logs?workspaceId=${WORKSPACE_ID}&details=full&includeTraceSpans=true&includeFinalOutput=true`
    )
  )
}

function readExecution() {
  return getExecution(
    apiRequest('/api/v1/logs/executions/exec-1'),
    createRouteContext({ executionId: 'exec-1' })
  )
}

function readDetail() {
  return getLogDetail(apiRequest(`/api/v1/logs/${LOG_ID}`), createRouteContext({ id: LOG_ID }))
}

beforeEach(() => {
  resetPermissionGroupScopeMock()
  mockAuthenticateV1Request.mockResolvedValue(v1PersonalKeyCredential(USER_ID))
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

  it('strips spend from the spans it still returns when only cost is hidden', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await listFull()).json()
    const [span] = body.data[0].traceSpans

    expect(span.name).toBe('agent')
    expect(span).not.toHaveProperty('cost')
    expect(span).not.toHaveProperty('tokens')
    expect(span.children[0]).not.toHaveProperty('cost')
  })

  /**
   * On a personal key the keyholder IS the governed member, so blanking every
   * run's cost while the envelope reports what those runs added up to this
   * period withholds nothing. `limit`, `plan` and `isExceeded` stay: they are
   * the caller's entitlement and eligibility, not a spend figure.
   */
  it('withholds the period spend in the limits envelope alongside the run totals', async () => {
    governedBy({ hideCostInfo: true })

    const body = await (await listFull()).json()

    expect(body.limits.usage.currentPeriodCost).toBeNull()
    expect(body.limits.usage).toMatchObject({ limit: 50, plan: 'pro', isExceeded: false })
  })

  it('withholds nothing from a workspace API key, whose creator has no say', async () => {
    mockAuthenticateV1Request.mockResolvedValue(v1WorkspaceKeyCredential(WORKSPACE_ID))
    governedBy({ hideTraceSpans: true, hideCostInfo: true })

    const body = await (await listFull()).json()
    const [log] = body.data

    expect(log.cost).toEqual({ total: 0.75 })
    expect(log.traceSpans).toHaveLength(1)
  })
})

/**
 * Blanking `cost` while still answering `minCost`/`maxCost` faithfully leaves
 * the list a bisection oracle over the very figure it just withheld: one
 * request per probe, with the page as the answer. The filter is therefore
 * refused rather than silently dropped — dropping it would answer a question
 * nobody asked, and a wrong answer presented as the right one is worse than a
 * refusal.
 */
describe('GET /api/v1/logs cost-selective queries', () => {
  function listFiltered(query: string) {
    return listLogs(apiRequest(`/api/v1/logs?workspaceId=${WORKSPACE_ID}&${query}`))
  }

  it.each([['minCost=0.5'], ['maxCost=0.5'], ['minCost=0.1&maxCost=0.9']])(
    'refuses %s for a group that withholds spend',
    async (query) => {
      governedBy({ hideCostInfo: true })

      const response = await listFiltered(query)

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: "Execution cost is not available under your organization's permission group",
        details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
      })
      expect(mockListPublicWorkflowLogs).not.toHaveBeenCalled()
    }
  )

  /**
   * The refusal must come from the caller's own membership, not from the door:
   * a non-member is told nothing about how the organization configured a group.
   */
  it('refuses a non-member for their access before naming the group', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    governedBy({ hideCostInfo: true })

    const response = await listFiltered('minCost=0.5')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
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
})

/**
 * The log surfaces answer "not found" for a workspace the caller cannot reach,
 * so a stranger cannot probe which ones exist. A permission-group refusal is
 * the one failure with nothing left to conceal: it runs only after the role
 * check passed, so the caller is already a known member being told how their
 * own organization configured their cohort.
 */
describe('v1 log surfaces and the personal-key group refusal', () => {
  beforeEach(() => {
    governedBy({ disablePersonalApiKeys: true })
  })

  it.each([
    ['GET /api/v1/logs/[id]', () => readDetail()],
    ['GET /api/v1/logs/executions/[executionId]', () => readExecution()],
  ])('%s keeps the structured detail rather than flattening it to 404', async (_name, call) => {
    const response = await call()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: expect.any(String),
      details: { code: 'PERSONAL_API_KEYS_DISABLED' },
    })
  })

  it.each([
    ['GET /api/v1/logs/[id]', () => readDetail(), 'Log not found'],
    [
      'GET /api/v1/logs/executions/[executionId]',
      () => readExecution(),
      'Workflow execution not found',
    ],
  ])('%s still conceals a caller with no workspace role', async (_name, call, message) => {
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const response = await call()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: message })
  })
})
