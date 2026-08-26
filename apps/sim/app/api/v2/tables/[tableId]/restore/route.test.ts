/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  getMaxRowsPerTable: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/tables', () => ({
  restoreTableUseCase: { operation: { id: 'tables.restore' }, execute: mocks.restore },
}))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))
vi.mock('@/lib/table/billing', () => ({ getMaxRowsPerTable: mocks.getMaxRowsPerTable }))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/tables/[tableId]/restore/route'

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
  createdBy: 'owner-1',
  name: 'Contacts (restored 4f2a)',
  description: null,
  schema: { columns: [] },
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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['owner-1', 'owner@example.com']]))
    mocks.getMaxRowsPerTable.mockResolvedValue(5000)
    mocks.restore.mockResolvedValue({ table: TABLE, folderPath: '/' })
  })

  it('delegates the asserted workspace and returns the restored table', async () => {
    const invocation = call({ workspaceId: WORKSPACE_ID })
    const response = await invocation.response

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.id).toBe('table-1')
    expect(body.data.name).toBe(TABLE.name)
    expect(mocks.restore).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: invocation.request,
    })
  })

  it('answers 409 for a table that is not archived', async () => {
    mocks.restore.mockRejectedValueOnce(new OrchestrationError('conflict', 'Table is not archived'))

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('CONFLICT')
  })

  it('conceals a table in another workspace as a 404', async () => {
    mocks.restore.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects a body that names no workspace', async () => {
    const response = await call({}).response

    expect(response.status).toBe(400)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated restore before parsing', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(401)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
})
