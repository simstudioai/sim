import { hybridAuthMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { permissionsMock } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { tableMock } from '@sim/testing/mocks/table.mock'
import { tableApiMock, tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { tableBillingMock } from '@sim/testing/mocks/table-billing.mock'
import {
  tableRouteUtilsMock,
  tableRouteUtilsMockFns,
} from '@sim/testing/mocks/table-route-utils.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { tableWireMock } from '@sim/testing/mocks/table-wire.mock'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/api', () => tableApiMock)
vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)

vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/app/api/table/utils', () => tableRouteUtilsMock)
vi.mock('@/lib/table/wire', () => tableWireMock)

import { GET, PATCH } from '@/app/api/table/[tableId]/route'

const { mockReadTableDetailsUseCase: mockReadTable } = tableApplicationTablesMockFns
const { mockAuthenticate } = tableApiMockFns
const { mockFindActiveFolder } = folderQueriesMockFns
const { mockCheckAccess } = tableRouteUtilsMockFns

const {
  mockDeleteTable,
  mockGetTableById,
  mockMoveTableToFolder,
  mockRenameTable,
  mockUpdateTableLocks,
} = tableServiceMockFns

const TABLE = {
  id: 'tbl_1',
  name: 'people',
  workspaceId: 'workspace-1',
  folderId: null as string | null,
  schema: { columns: [] },
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
}

function patchRequest(body: unknown): NextRequest {
  return createMockRequest({ method: 'PATCH', url: 'http://localhost:3000/api/table/tbl_1', body })
}

const routeContext = createRouteContext({ tableId: 'tbl_1' })

describe('PATCH /api/table/[tableId] folder moves', () => {
  beforeEach(() => {
    mockMoveTableToFolder.mockResolvedValue({ name: 'Table' })
    mockRenameTable.mockResolvedValue({ id: 'tbl_1', name: 'Table' })
    mockDeleteTable.mockResolvedValue({ archived: { name: 'Table', workspaceId: 'workspace-1' } })
    mockUpdateTableLocks.mockResolvedValue({
      table: { ...TABLE, locks: {} },
      previousLocks: {},
    })
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGetTableById.mockResolvedValue({ ...TABLE, folderId: 'folder-1' })
    mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  })

  it('rejects a folder from another workspace or resource tree without writing', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    const response = await PATCH(
      patchRequest({ workspaceId: 'workspace-1', folderId: 'kb-folder' }),
      routeContext
    )

    expect(response.status).toBe(404)
    expect(mockMoveTableToFolder).not.toHaveBeenCalled()
  })
})

describe('GET /api/table/[tableId] application adapter', () => {
  beforeEach(() => {
    mockAuthenticate.mockResolvedValue({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-canonical',
      delegationId: 'delegation-1',
      audience: 'sim:tables',
      issuedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-02'),
    })
    mockReadTable.mockResolvedValue({
      table: {
        ...TABLE,
        description: null,
        metadata: null,
        rowCount: 0,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      maxRows: 1000,
      folderPath: '/',
    })
  })

  it('uses the delegated principal workspace instead of the query assertion', async () => {
    const request = createMockRequest({
      url: 'http://localhost:3000/api/table/tbl_1?workspaceId=workspace-forged',
    })

    const response = await GET(request, routeContext)

    expect(mockReadTable).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(mockReadTable.mock.calls[0][0].input).toEqual({
      tableId: 'tbl_1',
      workspaceId: 'workspace-canonical',
    })
  })
})
