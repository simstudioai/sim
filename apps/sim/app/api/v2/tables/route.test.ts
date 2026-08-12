/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauthRate: vi.fn(),
  operationRate: vi.fn(),
  gate: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  getMaxRowsPerTable: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/table/application/tables', () => ({
  listTablesUseCase: { operation: { id: 'tables.list' }, execute: mocks.list },
  createTableUseCase: { operation: { id: 'tables.create' }, execute: mocks.create },
}))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))
vi.mock('@/lib/table/billing', () => ({
  getMaxRowsPerTable: mocks.getMaxRowsPerTable,
}))

import { GET, POST } from '@/app/api/v2/tables/route'

const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const rate = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
  retryAfterMs: 0,
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

describe('/api/v2/tables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['owner-1', 'owner@example.com']]))
    mocks.getMaxRowsPerTable.mockResolvedValue(5000)
    mocks.list.mockResolvedValue({
      tables: [{ table, folderPath: '/' }],
      nextKeys: undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    mocks.create.mockResolvedValue({ table, folderPath: '/' })
  })

  it('lists through the semantic use case and preserves the cursor envelope', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: 'table-1',
          folderPath: '/',
          description: null,
          ownerEmail: 'owner@example.com',
          maxRows: 5000,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, limit: 25 }),
      request,
    })
  })

  it('authenticates and rate-limits before rejecting invalid query input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/tables'))

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalled()
    expect(mocks.operationRate).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('maps operation rate-limit infrastructure failures to service unavailable', async () => {
    mocks.operationRate.mockRejectedValueOnce(new Error('rate store unavailable'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25`)
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('creates through the shared use case and keeps the 201 response contract', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string' }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({
      id: 'table-1',
      ownerEmail: 'owner@example.com',
      maxRows: 5000,
    })
    expect(mocks.create).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, name: 'Contacts' }),
      request,
    })
  })

  it('rejects required in a table column before calling the use case', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string', required: true }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
