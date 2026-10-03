import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/columns', () => ({
  addTableColumnUseCase: { operation: { id: 'tables.columns.add' }, execute: mocks.add },
  updateTableColumnUseCase: { operation: { id: 'tables.columns.update' }, execute: mocks.update },
  deleteTableColumnUseCase: { operation: { id: 'tables.columns.delete' }, execute: mocks.remove },
}))

import { PATCH, POST } from '@/app/api/v2/tables/[tableId]/columns/route'

const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const table = {
  id: 'table-1',
  name: 'Contacts',
  schema: {
    columns: [
      { id: 'col-1', name: 'Name', type: 'string' as const, required: false, unique: false },
    ],
  },
}
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

function request(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost:3000/api/v2/tables/table-1/columns', {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/tables/[tableId]/columns', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.add.mockResolvedValue({ table })
    mocks.update.mockResolvedValue({ table, changed: false, unmigrated: [] })
    mocks.remove.mockResolvedValue({ table })
  })

  it('forwards required on both the add and the update column write', async () => {
    await POST(
      request('POST', {
        workspaceId: WORKSPACE_ID,
        column: { name: 'Name', type: 'string', required: true },
      }),
      context
    )
    await PATCH(
      request('PATCH', {
        workspaceId: WORKSPACE_ID,
        columnName: 'Name',
        updates: { required: false },
      }),
      context
    )

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          column: { name: 'Name', type: 'string', required: true },
        }),
      })
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ updates: { required: false } }) })
    )
  })
})
