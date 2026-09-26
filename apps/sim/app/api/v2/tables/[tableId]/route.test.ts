import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)
vi.mock('@/lib/users/queries', () => usersQueriesMock)
vi.mock('@/lib/table/billing', () => tableBillingMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, GET, PATCH } from '@/app/api/v2/tables/[tableId]/route'

const { mockGetUserEmailsByIds } = usersQueriesMockFns
const { mockGetMaxRowsPerTable } = tableBillingMockFns
const { mockReadTableUseCase, mockUpdateTableUseCase, mockDeleteTableUseCase } =
  tableApplicationTablesMockFns

const WORKSPACE_ID = 'workspace-1'
const principal = createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID })
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const table = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  createdBy: 'owner-1',
  name: 'Contacts',
  description: null,
  schema: {
    columns: [
      { id: 'col-1', name: 'Name', type: 'string' as const, required: false, unique: false },
    ],
  },
  rowCount: 0,
  maxRows: 100,
  folderId: null,
  metadata: null,
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const context = createRouteContext({ tableId: 'table-1' })

function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/v2/tables/table-1${method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`}`,
    {
      method,
      headers: { 'x-api-key': 'secret', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  )
}

describe('/api/v2/tables/[tableId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockGetUserEmailsByIds.mockResolvedValue(new Map([['owner-1', 'owner@example.com']]))
    mockGetMaxRowsPerTable.mockResolvedValue(5000)
    mockReadTableUseCase.mockResolvedValue({ table, folderPath: '/' })
    mockUpdateTableUseCase.mockResolvedValue({
      table,
      folderPath: '/',
      applied: ['name'],
      changed: [],
    })
    mockDeleteTableUseCase.mockResolvedValue({
      id: 'table-1',
      deleted: true,
      archived: true,
      tableName: 'Contacts',
      workspaceId: WORKSPACE_ID,
      attributedUserId: 'owner-1',
    })
  })

  it('reads through the canonical authorized use case', async () => {
    const req = request('GET')
    const response = await GET(req, context)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      id: 'table-1',
      webUrl: `https://test.sim.ai/workspace/${WORKSPACE_ID}/tables/table-1`,
      ownerEmail: 'owner@example.com',
      maxRows: 5000,
    })
    expect(mockReadTableUseCase).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('reports committed fields when a later composite PATCH step fails', async () => {
    mockUpdateTableUseCase.mockResolvedValueOnce({
      table,
      folderPath: null,
      applied: ['name'],
      changed: ['name'],
      failure: new OrchestrationError('not_found', 'Folder not found'),
    })

    const response = await PATCH(
      request('PATCH', {
        workspaceId: WORKSPACE_ID,
        name: 'Renamed',
        folderPath: '/Missing',
      }),
      context
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.details).toEqual({ applied: ['name'] })
  })

  it('conceals a typed authorization failure on every verb, not just the read', async () => {
    mockReadTableUseCase.mockRejectedValueOnce(new NoWorkspaceAccessError())
    mockUpdateTableUseCase.mockRejectedValueOnce(new NoWorkspaceAccessError())
    mockDeleteTableUseCase.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const responses = await Promise.all([
      GET(request('GET'), context),
      PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, name: 'Renamed' }), context),
      DELETE(request('DELETE'), context),
    ])

    for (const response of responses) {
      expect(response.status).toBe(404)
      expect((await response.json()).error).toEqual({
        code: 'NOT_FOUND',
        message: 'Table not found',
      })
    }
  })
})
