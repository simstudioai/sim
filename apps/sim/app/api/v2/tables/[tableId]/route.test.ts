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
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  capture: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  getMaxRowsPerTable: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/table/application/tables', () => ({
  readTableUseCase: { operation: { id: 'tables.read' }, execute: mocks.read },
  updateTableUseCase: { operation: { id: 'tables.update' }, execute: mocks.update },
  deleteTableUseCase: { operation: { id: 'tables.delete' }, execute: mocks.remove },
}))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))
vi.mock('@/lib/table/billing', () => ({
  getMaxRowsPerTable: mocks.getMaxRowsPerTable,
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, GET, PATCH } from '@/app/api/v2/tables/[tableId]/route'

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
const context = { params: Promise.resolve({ tableId: 'table-1' }) }

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
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['owner-1', 'owner@example.com']]))
    mocks.getMaxRowsPerTable.mockResolvedValue(5000)
    mocks.read.mockResolvedValue({ table, folderPath: '/' })
    mocks.update.mockResolvedValue({
      table,
      folderPath: '/',
      applied: ['name'],
      changed: [],
    })
    mocks.remove.mockResolvedValue({
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
    expect(mocks.read).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('preserves a successful no-op PATCH response', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, name: 'Contacts' }),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      name: 'Contacts',
      ownerEmail: 'owner@example.com',
      maxRows: 5000,
    })
  })

  it('reports committed fields when a later composite PATCH step fails', async () => {
    mocks.update.mockResolvedValueOnce({
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
    mocks.read.mockRejectedValueOnce(new NoWorkspaceAccessError())
    mocks.update.mockRejectedValueOnce(new NoWorkspaceAccessError())
    mocks.remove.mockRejectedValueOnce(new NoWorkspaceAccessError())

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

  it('keeps delete analytics surface-specific after authoritative success', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'table-1', deleted: true } })
    expect(mocks.capture).toHaveBeenCalledWith(
      'owner-1',
      'table_deleted',
      { table_id: 'table-1', workspace_id: WORKSPACE_ID },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })
})
