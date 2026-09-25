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
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
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

import {
  WorkspaceFileFolderConflictError,
  WorkspaceFileItemsNotFoundError,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { GET, PATCH, POST } from '@/app/api/v2/files/folders/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
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
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listFolders.mockResolvedValue({ folders: [folder] })
    mocks.createFolder.mockResolvedValue({ folder })
    mocks.updateFolder.mockResolvedValue({ folder })
    mocks.deleteFolder.mockResolvedValue({
      deletedItems: { folders: 1, files: 2 },
      path: '/Reports',
    })
  })

  it('preserves an escaped slash within a folder name', async () => {
    mocks.listFolders.mockResolvedValueOnce({
      folders: [{ ...folder, name: 'Finance/Legal', path: 'Finance\\/Legal' }],
    })

    const response = await GET(
      request('GET', `/api/v2/files/folders?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toMatchObject({
      name: 'Finance/Legal',
      path: '/Finance%2FLegal',
      parentPath: '/',
    })
  })

  it('fails when a canonical path does not match the returned folder name', async () => {
    mocks.listFolders.mockResolvedValueOnce({
      folders: [{ ...folder, name: 'Finance/Legal', path: '/Finance/Legal' }],
    })

    const response = await GET(
      request('GET', `/api/v2/files/folders?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(500)
  })

  it('maps a duplicate folder name raised inside a drizzle transaction to 409', async () => {
    const wrapped = new Error('insert into "folder" ...', {
      cause: new WorkspaceFileFolderConflictError('Reports'),
    })
    mocks.createFolder.mockRejectedValueOnce(wrapped)

    const response = await POST(
      request('POST', '/api/v2/files/folders', { workspaceId: WORKSPACE_ID, path: '/Reports' }),
      context
    )

    expect(response.status).toBe(409)
  })

  it('maps missing folder items to 404 rather than a 500', async () => {
    mocks.updateFolder.mockRejectedValueOnce(
      new WorkspaceFileItemsNotFoundError([], ['folder-missing'])
    )

    const response = await PATCH(
      request('PATCH', '/api/v2/files/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        destinationPath: '/Archive/Reports',
      }),
      context
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects a percent-encoded NUL in a canonical path before the write reaches Postgres', async () => {
    const created = await POST(
      request('POST', '/api/v2/files/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/apitest_%00x',
      }),
      context
    )
    const relocated = await PATCH(
      request('PATCH', '/api/v2/files/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        destinationPath: '/apitest_%00b',
      }),
      context
    )

    expect(created.status).toBe(400)
    expect((await created.json()).error.code).toBe('BAD_REQUEST')
    expect(relocated.status).toBe(400)
    expect((await relocated.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.createFolder).not.toHaveBeenCalled()
    expect(mocks.updateFolder).not.toHaveBeenCalled()
  })
})
