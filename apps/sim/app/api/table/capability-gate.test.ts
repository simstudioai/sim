/**
 * @vitest-environment node
 *
 * Every raw route under `/api/table/**` authorizes through `checkAccess`, which
 * predates the operation boundary and so is never reached by the authorization
 * funnel that applies `tables.use` to `tableOperations`. These pin the gate
 * `checkAccess` now carries, on a write path and a read path, against the real
 * `checkAccess` and `accessError` rather than a mock of them.
 *
 * The write path is column creation on purpose: a TTL column is the only column
 * configuration that causes rows to be deleted on a schedule, so a member of a
 * group denied Tables driving this route is the worst of the sixteen.
 */
import {
  hybridAuthMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTableById, mockGetUserEntityPermissions, mockAddTableColumn, mockListTableViews } =
  vi.hoisted(() => ({
    mockGetTableById: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockAddTableColumn: vi.fn(),
    mockListTableViews: vi.fn(),
  }))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/table', () => ({
  addTableColumn: mockAddTableColumn,
  buildFilterClause: vi.fn(),
  createTableView: vi.fn(),
  deleteColumn: vi.fn(),
  getTableById: mockGetTableById,
  listTableViews: mockListTableViews,
  TableQueryValidationError: class TableQueryValidationError extends Error {},
  TableViewValidationError: class TableViewValidationError extends Error {},
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: vi.fn() }))
vi.mock('@/lib/table/orchestration', () => ({ performUpdateTableColumn: vi.fn() }))
vi.mock('@/lib/table/wire', () => ({ normalizeColumn: (column: unknown) => column }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/lib/workspaces/utils', () => ({ getWorkspaceOrganizationId: vi.fn() }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { POST } from '@/app/api/table/[tableId]/columns/route'
import { GET } from '@/app/api/table/[tableId]/views/route'

const USER_ID = 'user-1'
const TABLE_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

const TABLE = {
  id: TABLE_ID,
  name: 'expenses',
  workspaceId: WORKSPACE_ID,
  rowCount: 0,
  schema: { columns: [] },
}

/** A TTL column — the configuration that deletes rows on a schedule. */
function addTtlColumn() {
  return POST(
    new NextRequest(`http://localhost/api/table/${TABLE_ID}/columns`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        column: { name: 'expires_at', type: 'ttl' },
      }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ tableId: TABLE_ID }) }
  )
}

function listViews() {
  return GET(
    new NextRequest(`http://localhost/api/table/${TABLE_ID}/views?workspaceId=${WORKSPACE_ID}`),
    { params: Promise.resolve({ tableId: TABLE_ID }) }
  )
}

describe('tables.use gate on the raw /api/table routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: USER_ID,
      authType: 'session',
    })
    mockGetTableById.mockResolvedValue(TABLE)
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockAddTableColumn.mockResolvedValue({ schema: { columns: [{ name: 'expires_at' }] } })
    mockListTableViews.mockResolvedValue([])
  })

  describe('when the group withholds Tables', () => {
    beforeEach(() => {
      permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideTablesTab: true,
      })
    })

    it('refuses adding a TTL column, and never writes the schema', async () => {
      const response = await addTtlColumn()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: "The Tables module is not available under your organization's permission group",
        details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
      })
      expect(mockAddTableColumn).not.toHaveBeenCalled()
    })

    it('refuses the read path, and never reads the views', async () => {
      const response = await listViews()

      expect(response.status).toBe(403)
      expect((await response.json()).details).toEqual({
        code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      })
      expect(mockListTableViews).not.toHaveBeenCalled()
    })

    it('still conceals a table the caller cannot reach, rather than naming the capability', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const response = await listViews()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Access denied' })
    })

    it('still 404s a table that does not exist, rather than naming the capability', async () => {
      mockGetTableById.mockResolvedValue(null)

      const response = await listViews()

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Table not found' })
    })
  })

  describe('when no group withholds Tables', () => {
    it('lets the TTL column through', async () => {
      const response = await addTtlColumn()

      expect(response.status).toBe(200)
      expect(mockAddTableColumn).toHaveBeenCalledTimes(1)
    })

    it('lets the read path through', async () => {
      const response = await listViews()

      expect(response.status).toBe(200)
      expect(mockListTableViews).toHaveBeenCalledTimes(1)
    })

    it('lets a governed group that withholds something else through', async () => {
      permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideKnowledgeBaseTab: true,
      })

      const response = await addTtlColumn()

      expect(response.status).toBe(200)
      expect(mockAddTableColumn).toHaveBeenCalledTimes(1)
    })
  })
})
