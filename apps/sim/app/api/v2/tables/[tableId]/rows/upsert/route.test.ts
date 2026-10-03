import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

import { POST } from '@/app/api/v2/tables/[tableId]/rows/upsert/route'

const { mockUpsertTableRow } = tableApplicationRowsMockFns

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const TABLE = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  schema: { columns: [{ id: 'column-email', name: 'email', type: 'string' as const }] },
}
const ROW = {
  id: 'row-1',
  data: { 'column-email': 'ada@example.com' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('POST /api/v2/tables/[tableId]/rows/upsert', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockUpsertTableRow.mockResolvedValue({ table: TABLE, row: ROW, operation: 'update' })
  })

  it('delegates the public conflict-target name unchanged for canonical ID resolution', async () => {
    const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        data: { email: 'ada@example.com' },
        conflictTarget: 'email',
      }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ tableId: 'table-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        row: {
          id: 'row-1',
          data: { email: 'ada@example.com' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        operation: 'update',
      },
    })
    expect(mockUpsertTableRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        data: { email: 'ada@example.com' },
        conflictTarget: 'email',
        strictWrite: true,
        dataKeying: 'names',
      },
      request,
    })
  })
})
