/**
 * @vitest-environment node
 *
 * `/api/v1/tables/[tableId]/**` shares `checkAccess` with the raw internal
 * `/api/table/**` routes, and `checkAccess` gates `tables.use` inside itself.
 * That gate is correct for the internal routes — `checkSessionOrInternalAuth`
 * rejects `x-api-key`, so every caller there is a person. v1 authenticates with
 * an API key, and a WORKSPACE key reports its creator's user id: gating on that
 * id applies a bystander's permission group to every caller of a shared
 * credential, which is exactly what `principal-scope.server.ts` and the
 * `workspace_api_key` branch of `authorizeWorkspaceOperation` refuse to do.
 *
 * These run the real middleware and the real `checkAccess` against the real
 * route — only the credential, the rate bucket, the workspace role, the table
 * row and the governing group config are mocked.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
  v1RateLimitContextModuleMock,
  v1RateLimiterModuleMock,
  v1SubscriptionModuleMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateV1Request,
  mockGetUserEntityPermissions,
  mockGetWorkspaceBillingSettings,
  mockGetTableById,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockGetTableById: vi.fn(),
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
vi.mock('@/lib/billing/core/subscription', () => v1SubscriptionModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v1RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/table', () => ({
  getTableById: mockGetTableById,
  buildFilterClause: vi.fn(),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))
vi.mock('@/lib/table/orchestration', () => ({ performDeleteTable: vi.fn() }))
vi.mock('@/lib/table/wire', () => ({ normalizeColumn: (column: unknown) => column }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as getTable } from '@/app/api/v1/tables/[tableId]/route'

const MEMBER_ID = 'user-1'
const TABLE_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

const TABLE = {
  id: TABLE_ID,
  name: 'expenses',
  workspaceId: WORKSPACE_ID,
  description: null,
  rowCount: 0,
  maxRows: 1000,
  locks: null,
  schema: { columns: [] },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function personalKey() {
  return {
    authenticated: true,
    userId: MEMBER_ID,
    keyType: 'personal' as const,
    principal: { kind: 'personal_api_key' as const, userId: MEMBER_ID, keyId: 'key-1' },
  }
}

/**
 * A workspace key still reports a `userId` — the key's CREATOR. A gate keyed on
 * the presence of a user id rather than on the principal kind would apply that
 * bystander's group to every caller of the shared credential.
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

function readTable() {
  return getTable(
    new NextRequest(`http://localhost/api/v1/tables/${TABLE_ID}?workspaceId=${WORKSPACE_ID}`, {
      method: 'GET',
      headers: { 'x-api-key': 'sim_test' },
    }),
    { params: Promise.resolve({ tableId: TABLE_ID }) }
  )
}

const REFUSAL = /is not available under your organization's permission group/

beforeEach(() => {
  vi.clearAllMocks()
  resetPermissionGroupScopeMock()
  mockAuthenticateV1Request.mockResolvedValue(personalKey())
  mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: true })
  mockGetTableById.mockResolvedValue(TABLE)
})

describe('tables.use gate on /api/v1/tables/[tableId]', () => {
  it('lets a workspace API key through even when its CREATOR is denied Tables', async () => {
    mockAuthenticateV1Request.mockResolvedValue(workspaceKey())
    governedBy({ hideTablesTab: true })

    const response = await readTable()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.table.id).toBe(TABLE_ID)
  })

  it('never resolves a group for a workspace API key at all', async () => {
    mockAuthenticateV1Request.mockResolvedValue(workspaceKey())
    governedBy({ hideTablesTab: true })

    await readTable()

    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('still refuses a personal API key whose group withholds Tables', async () => {
    governedBy({ hideTablesTab: true })

    const response = await readTable()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toMatch(REFUSAL)
    expect(body.details).toEqual({ code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' })
  })

  it('lets a personal API key through when no group withholds Tables', async () => {
    const response = await readTable()

    expect(response.status).toBe(200)
  })

  it('still refuses either key kind on role, before naming the capability', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    governedBy({ hideTablesTab: true })

    const response = await readTable()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
  })
})
