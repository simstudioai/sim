/**
 * The v1 public API authorizes in `app/api/v1/middleware.ts` rather than
 * through `authorizeWorkspaceOperation`, so none of the capabilities the funnel
 * applies to the v2 and internal surfaces reached it. A member of a group that
 * withholds Tables was refused on `/api/v2/tables/**` and on every internal
 * `/api/table/**` route, and could still do the same work through
 * `/api/v1/tables/**` with a personal API key.
 *
 * These run the real middleware against the real routes — only the credential,
 * the rate bucket, the workspace role and the governing group config are
 * mocked — so they fail if the capability a route declares is dropped, is
 * checked before the role check, or starts applying to a workspace API key.
 *
 * Scope: capability GATES only. `logs.cost` and `logs.trace_spans` are
 * projections rather than gates — a route declaring `'none'` withholds fields
 * instead of refusing — and are pinned in `app/api/v1/logs/projection.test.ts`.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
  v1PersonalKeyCredential,
  v1RateLimitContextModuleMock,
  v1RateLimiterModuleMock,
  v1SubscriptionModuleMock,
  v1WorkspaceKeyCredential,
} from '@sim/testing'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import { tableWireMock } from '@sim/testing/mocks/table-wire.mock'
import { traceStoreMock } from '@sim/testing/mocks/trace-store.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { workflowsOrchestrationMock } from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateV1Request, mockListPublicWorkflowLogs, mockGetDeploymentWorkflowTarget } =
  vi.hoisted(() => ({
    mockAuthenticateV1Request: vi.fn(),
    mockListPublicWorkflowLogs: vi.fn(),
    mockGetDeploymentWorkflowTarget: vi.fn(),
  }))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/app/api/v1/auth', () => ({ authenticateV1Request: mockAuthenticateV1Request }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/billing/core/subscription', () => v1SubscriptionModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v1RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/wire', () => tableWireMock)
vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/lib/knowledge/orchestration', () => ({ performCreateKnowledgeBase: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/logs/public-queries', () => ({
  listPublicWorkflowLogs: mockListPublicWorkflowLogs,
  decodePublicLogCursor: vi.fn(),
}))
vi.mock('@/lib/logs/execution/trace-store', () => traceStoreMock)
vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)
vi.mock('@/lib/workflows/deployments/queries', () => ({
  getDeploymentWorkflowTarget: mockGetDeploymentWorkflowTarget,
}))
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as getLogs } from '@/app/api/v1/logs/route'
import { GET as getTables } from '@/app/api/v1/tables/route'

const { mockGetWorkspaceBillingSettings } = workspacesUtilsMockFns
workspacesUtilsMockFns.mockGetWorkspaceBilledAccountUserId.mockImplementation(
  async () => 'billed-user'
)
const { mockListTables } = tableMockFns
tableMockFns.mockGetWorkspaceTableLimits.mockImplementation(async () => ({ maxTables: 10 }))
const { mockGetWorkspaceKnowledgeBases: mockListKnowledgeBases } = knowledgeServiceMockFns

v1LogsMetaMockFns.mockGetUserLimits.mockImplementation(async () => ({ usage: {} }))
v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))
const { mockGetUserEntityPermissions } = permissionsMockFns
const { mockListWorkspaceFiles } = workspaceUploadsMockFns

const USER_ID = 'user-1'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const WORKFLOW_ID = 'wf-1'

function governedBy(overrides: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG>) {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    ...overrides,
  })
}

function get(path: string) {
  return createMockRequest({
    method: 'GET',
    url: `http://localhost${path}`,
    headers: { 'x-api-key': 'sim_test' },
  })
}

const REFUSAL = /is not available under your organization's permission group/

beforeEach(() => {
  resetPermissionGroupScopeMock()
  mockAuthenticateV1Request.mockResolvedValue(v1PersonalKeyCredential(USER_ID))
  mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: true })
  mockListTables.mockResolvedValue([])
  mockListKnowledgeBases.mockResolvedValue({ data: [], nextCursorKeys: null })
  mockListWorkspaceFiles.mockResolvedValue([])
  mockListPublicWorkflowLogs.mockResolvedValue({ data: [], nextCursor: null })
  mockGetDeploymentWorkflowTarget.mockResolvedValue({
    workflow: { id: WORKFLOW_ID, name: 'wf', isDeployed: false },
    workspaceId: WORKSPACE_ID,
  })
})

describe('v1 permission-group capability gate', () => {
  describe('refuses a personal key whose group withholds the module', () => {
    it('tables — GET /api/v1/tables declares tables.use', async () => {
      governedBy({ hideTablesTab: true })

      const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toMatch(REFUSAL)
      expect(body.details).toEqual({ code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' })
      expect(mockListTables).not.toHaveBeenCalled()
    })
  })

  describe('exceptions that must keep working', () => {
    it('a workspace API key passes through ungated — it has no user, so no group', async () => {
      mockAuthenticateV1Request.mockResolvedValue(v1WorkspaceKeyCredential(WORKSPACE_ID))
      governedBy({ hideTablesTab: true })

      const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))

      expect(response.status).toBe(200)
      expect(mockListTables).toHaveBeenCalledWith(WORKSPACE_ID)
    })

    it('a route declaring none is unaffected by a group that withholds everything', async () => {
      governedBy({
        hideTablesTab: true,
        hideKnowledgeBaseTab: true,
        hideFilesTab: true,
        hideDeployApi: true,
      })

      const response = await getLogs(get(`/api/v1/logs?workspaceId=${WORKSPACE_ID}`))

      expect(response.status).toBe(200)
      expect(mockListPublicWorkflowLogs).toHaveBeenCalled()
    })
  })

  /**
   * `personal_api_key.use` refuses a *principal kind* rather than a module, so it
   * is asserted separately from the capability the route declares — but, like
   * every other group key, only after the workspace role check. A workspace key
   * is not a personal key, and its creator's group must not decide whether it
   * may be used.
   */
  describe('personal_api_key.use — the key kind, not the module', () => {
    it('refuses a personal key whose group disables personal API keys', async () => {
      governedBy({ disablePersonalApiKeys: true })

      const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toMatch(/personal API key/i)
      expect(mockListTables).not.toHaveBeenCalled()
    })

    /**
     * The group key runs behind the role check, so a stranger to the workspace
     * is answered with the concealed role failure rather than with a refusal
     * naming how an organization configured one of its cohorts. Asked the other
     * way round, a caller with no reach into the workspace at all learns that
     * the workspace's organization runs a group, and that the group withholds
     * personal keys.
     *
     * The workspace COLUMN still answers first — it names no group, needs no
     * query, and is the answer whatever the role turns out to be — which is the
     * split `authorizeWorkspaceOperation` makes and the next case pins.
     */
    it('answers a non-member on role, not on the group that withholds personal keys', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)
      governedBy({ disablePersonalApiKeys: true })

      const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBe('Access denied')
      expect(mockListTables).not.toHaveBeenCalled()
    })
  })

  it('refuses on role before capability, so a non-member learns nothing about the group', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    governedBy({ hideTablesTab: true })

    const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Access denied')
    expect(body.details).toBeUndefined()
  })
})
