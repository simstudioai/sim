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
  update: vi.fn(),
  remove: vi.fn(),
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
vi.mock('@/lib/table/application/folders', () => ({
  listTableFoldersUseCase: { operation: { id: 'tables.folders.list' }, execute: mocks.list },
  createTableFolderUseCase: { operation: { id: 'tables.folders.create' }, execute: mocks.create },
  updateTableFolderUseCase: { operation: { id: 'tables.folders.update' }, execute: mocks.update },
  deleteTableFolderUseCase: { operation: { id: 'tables.folders.delete' }, execute: mocks.remove },
}))

import { DELETE, GET, PATCH, POST } from '@/app/api/v2/tables/folders/route'

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
const folder = {
  id: 'folder-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  resourceType: 'table' as const,
  name: 'Reports',
  parentId: null,
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const index = {
  rowById: new Map([['folder-1', folder]]),
  pathById: new Map([['folder-1', '/Reports']]),
  idByPath: new Map([['/Reports', 'folder-1']]),
}

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'x-api-key': 'secret', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('/api/v2/tables/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
    mocks.list.mockResolvedValue({ folders: [folder], index })
    mocks.create.mockResolvedValue({ folder, index, path: '/Reports' })
    mocks.update.mockResolvedValue({
      folder,
      index,
      path: '/Reports',
      sourcePath: '/Archive/Reports',
    })
    mocks.remove.mockResolvedValue({
      path: '/Reports',
      deleted: true,
      deletedItems: { folders: 1, tables: 2 },
    })
  })

  it('lists canonical paths through the folder read use case', async () => {
    const req = request('GET', `/api/v2/tables/folders?workspaceId=${WORKSPACE_ID}`)
    const response = await GET(req)

    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toMatchObject({ path: '/Reports', parentPath: '/' })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      request: req,
    })
  })

  it('delegates create and relocate without route-local authorization', async () => {
    const createResponse = await POST(
      request('POST', '/api/v2/tables/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
      })
    )
    const updateResponse = await PATCH(
      request('PATCH', '/api/v2/tables/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Archive/Reports',
        destinationPath: '/Reports',
      })
    )

    expect(createResponse.status).toBe(201)
    expect(updateResponse.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it('returns authoritative recursive deletion counts', async () => {
    const response = await DELETE(
      request(
        'DELETE',
        `/api/v2/tables/folders?workspaceId=${WORKSPACE_ID}&path=%2FReports&recursive=true`
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        path: '/Reports',
        deleted: true,
        deletedItems: { folders: 1, tables: 2 },
      },
    })
  })
})
