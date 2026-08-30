/**
 * @vitest-environment node
 *
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
  mockListTables,
  mockListKnowledgeBases,
  mockListWorkspaceFiles,
  mockListPublicWorkflowLogs,
  mockGetDeploymentWorkflowTarget,
  mockPerformFullDeploy,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockListTables: vi.fn(),
  mockListKnowledgeBases: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockListPublicWorkflowLogs: vi.fn(),
  mockGetDeploymentWorkflowTarget: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/app/api/v1/auth', () => ({ authenticateV1Request: mockAuthenticateV1Request }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
  getWorkspaceBilledAccountUserId: vi.fn(async () => 'billed-user'),
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

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/table', () => ({
  listTables: mockListTables,
  createTable: vi.fn(),
  getWorkspaceTableLimits: vi.fn(async () => ({ maxTables: 10 })),
  TableConflictError: class TableConflictError extends Error {},
}))
vi.mock('@/lib/table/wire', () => ({ normalizeColumn: (column: unknown) => column }))
vi.mock('@/lib/knowledge/service', () => ({
  listWorkspaceAndLegacyKnowledgeBases: mockListKnowledgeBases,
  getKnowledgeBaseById: vi.fn(),
}))
vi.mock('@/lib/knowledge/orchestration', () => ({ performCreateKnowledgeBase: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
  getWorkspaceFile: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
  FileConflictError: class FileConflictError extends Error {},
}))
vi.mock('@/lib/logs/public-queries', () => ({
  listPublicWorkflowLogs: mockListPublicWorkflowLogs,
  decodePublicLogCursor: vi.fn(),
}))
vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: vi.fn(),
}))
vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn(async () => ({})),
  createApiResponse: (body: unknown) => ({ body, headers: {} }),
}))
vi.mock('@/lib/workflows/deployments/queries', () => ({
  getDeploymentWorkflowTarget: mockGetDeploymentWorkflowTarget,
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as getFiles } from '@/app/api/v1/files/route'
import { GET as getKnowledge } from '@/app/api/v1/knowledge/route'
import { GET as getLogs } from '@/app/api/v1/logs/route'
import { GET as getTables } from '@/app/api/v1/tables/route'
import { POST as deployWorkflow } from '@/app/api/v1/workflows/[id]/deploy/route'

const USER_ID = 'user-1'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const WORKFLOW_ID = 'wf-1'

function personalKey() {
  return {
    authenticated: true,
    userId: USER_ID,
    keyType: 'personal' as const,
    principal: { kind: 'personal_api_key' as const, userId: USER_ID, keyId: 'key-1' },
  }
}

/**
 * A workspace key still reports a `userId` — the key's creator — so a gate keyed
 * on the presence of a user rather than on `keyType` would silently apply a
 * bystander's group to every caller of a shared credential.
 */
function workspaceKey() {
  return {
    authenticated: true,
    userId: 'key-creator',
    workspaceId: WORKSPACE_ID,
    keyType: 'workspace' as const,
    principal: {
      kind: 'workspace_api_key' as const,
      workspaceId: WORKSPACE_ID,
      keyId: 'key-2',
    },
  }
}

function governedBy(overrides: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG>) {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    ...overrides,
  })
}

function get(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-api-key': 'sim_test' },
  })
}

function deployRequest() {
  return [
    new NextRequest(`http://localhost/api/v1/workflows/${WORKFLOW_ID}/deploy`, {
      method: 'POST',
      headers: { 'x-api-key': 'sim_test', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: WORKFLOW_ID }) },
  ] as const
}

const REFUSAL = /is not available under your organization's permission group/

beforeEach(() => {
  vi.clearAllMocks()
  resetPermissionGroupScopeMock()
  mockAuthenticateV1Request.mockResolvedValue(personalKey())
  mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: true })
  mockListTables.mockResolvedValue([])
  mockListKnowledgeBases.mockResolvedValue([])
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

    it('knowledge — GET /api/v1/knowledge declares knowledge.use', async () => {
      governedBy({ hideKnowledgeBaseTab: true })

      const response = await getKnowledge(get(`/api/v1/knowledge?workspaceId=${WORKSPACE_ID}`))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toMatch(REFUSAL)
      expect(mockListKnowledgeBases).not.toHaveBeenCalled()
    })

    it('files — GET /api/v1/files declares files.use', async () => {
      governedBy({ hideFilesTab: true })

      const response = await getFiles(get(`/api/v1/files?workspaceId=${WORKSPACE_ID}`))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toMatch(REFUSAL)
      expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
    })

    it('workflows — POST /api/v1/workflows/[id]/deploy declares deploy.api', async () => {
      governedBy({ hideDeployApi: true })

      const response = await deployWorkflow(...deployRequest())

      /** The deployment routes mask every access failure as 404, so the status
       * is the 404 they already return; what the gate changes is that the
       * deploy never happens. */
      expect(response.status).toBe(404)
      expect(mockPerformFullDeploy).not.toHaveBeenCalled()
    })
  })

  describe('exceptions that must keep working', () => {
    it('a workspace API key passes through ungated — it has no user, so no group', async () => {
      mockAuthenticateV1Request.mockResolvedValue(workspaceKey())
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

    it('an ungoverned workspace resolves no config and is never refused', async () => {
      const response = await getTables(get(`/api/v1/tables?workspaceId=${WORKSPACE_ID}`))

      expect(response.status).toBe(200)
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
