/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      listFolders: vi.fn(),
      createFolder: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  listWorkspaceFileFoldersOperation: {
    operation: { id: 'files.folders.list', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.listFolders,
  },
  createWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createFolder,
  },
  updateWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateFolder,
  },
  deleteWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.deleteFolder,
  },
}))

import { DELETE, GET, PATCH, POST } from '@/app/api/v2/files/folders/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}
const folder = {
  id: 'folder-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  name: 'Reports',
  parentId: null,
  path: '/Reports',
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const context = undefined

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/files/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.listFolders.mockResolvedValue({ folders: [folder] })
    mocks.createFolder.mockResolvedValue({ folder })
    mocks.updateFolder.mockResolvedValue({ folder })
    mocks.deleteFolder.mockResolvedValue({
      deletedItems: { folders: 1, files: 2 },
      path: '/Reports',
    })
  })

  it('lists folders through the shared operation and v2 presenter', async () => {
    const response = await GET(
      request('GET', `/api/v2/files/folders?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([
      {
        name: 'Reports',
        path: '/Reports',
        parentPath: '/',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        parentPath: undefined,
        search: undefined,
        sortBy: 'name',
        sortOrder: 'asc',
      },
      request: expect.anything(),
    })
  })

  it('creates a folder from its canonical path', async () => {
    const response = await POST(
      request('POST', '/api/v2/files/folders', { workspaceId: WORKSPACE_ID, path: '/Reports' }),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.folder).toEqual({
      name: 'Reports',
      path: '/Reports',
      parentPath: '/',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(mocks.createFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, path: '/Reports' },
      request: expect.anything(),
    })
  })

  it('relocates a folder through the shared operation', async () => {
    const response = await PATCH(
      request('PATCH', '/api/v2/files/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        destinationPath: '/Archive/Reports',
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.updateFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        destinationPath: '/Archive/Reports',
      },
      request: expect.anything(),
    })
  })

  it('deletes a folder and returns the v2 deletion result', async () => {
    const response = await DELETE(
      request(
        'DELETE',
        `/api/v2/files/folders?workspaceId=${WORKSPACE_ID}&path=%2FReports&recursive=true`
      ),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      path: '/Reports',
      deleted: true,
      deletedItems: { folders: 1, files: 2 },
    })
  })

  it('authenticates before parsing folder input', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/files/folders', {}), context)

    expect(response.status).toBe(401)
    expect(mocks.createFolder).not.toHaveBeenCalled()
  })
})
