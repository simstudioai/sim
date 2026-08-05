/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockLoadActiveFolderPathIndex,
  mockListActiveFolderRows,
  mockCreateFolderAtPath,
  mockRelocateFolderByPath,
  mockDeleteFolderByPath,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  mockListActiveFolderRows: vi.fn(),
  mockCreateFolderAtPath: vi.fn(),
  mockRelocateFolderByPath: vi.fn(),
  mockDeleteFolderByPath: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
  listActiveFolderRows: mockListActiveFolderRows,
}))

vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPath: mockCreateFolderAtPath,
  relocateFolderByPath: mockRelocateFolderByPath,
  deleteFolderByPath: mockDeleteFolderByPath,
}))

import { DELETE, GET, PATCH, POST } from '@/app/api/v2/workflows/folders/route'

const WORKSPACE_ID = 'workspace-1'
const FOLDER_ID = 'internal-folder-id'
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const folder = {
  id: FOLDER_ID,
  resourceType: 'workflow' as const,
  name: 'Reports',
  userId: 'user-1',
  workspaceId: WORKSPACE_ID,
  parentId: null,
  sortOrder: 0,
  locked: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
  deletedAt: null,
}

function pathIndex(path = '/Reports') {
  return {
    rowById: new Map([[FOLDER_ID, folder]]),
    pathById: new Map([[FOLDER_ID, path]]),
    idByPath: new Map([[path, FOLDER_ID]]),
  }
}

function request(method: string, path: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/v2/workflows/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockLoadActiveFolderPathIndex.mockResolvedValue(pathIndex())
    mockListActiveFolderRows.mockResolvedValue([folder])
    mockCreateFolderAtPath.mockResolvedValue({
      success: true,
      folder,
      path: '/Reports',
    })
    mockRelocateFolderByPath.mockResolvedValue({
      success: true,
      folder,
      path: '/Reports',
    })
    mockDeleteFolderByPath.mockResolvedValue({
      success: true,
      path: '/Reports',
      deletedItems: { folders: 1, workflows: 2 },
    })
  })

  it('lists only root children when parentPath is root and never exposes database ids', async () => {
    const response = await GET(
      request('GET', `/api/v2/workflows/folders?workspaceId=${WORKSPACE_ID}&parentPath=%2F`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockListActiveFolderRows).toHaveBeenCalledWith(WORKSPACE_ID, 'workflow', {
      parentId: null,
      search: undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(body.data).toEqual([
      {
        name: 'Reports',
        path: '/Reports',
        parentPath: '/',
        locked: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
  })

  it('omits the parent filter to list folders from the whole tree', async () => {
    await GET(request('GET', `/api/v2/workflows/folders?workspaceId=${WORKSPACE_ID}`))

    expect(mockListActiveFolderRows).toHaveBeenCalledWith(WORKSPACE_ID, 'workflow', {
      parentId: undefined,
      search: undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    })
  })

  it('creates a folder from a canonical path and rejects internal ids', async () => {
    const created = await POST(
      request('POST', '/api/v2/workflows/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
      })
    )

    expect(created.status).toBe(201)
    expect(mockCreateFolderAtPath).toHaveBeenCalledWith({
      resourceType: 'workflow',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      path: '/Reports',
    })

    const rejected = await POST(
      request('POST', '/api/v2/workflows/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        folderId: FOLDER_ID,
      })
    )
    expect(rejected.status).toBe(400)
  })

  it('relocates one folder by source and destination paths', async () => {
    mockLoadActiveFolderPathIndex.mockResolvedValue(pathIndex('/Archive'))
    const response = await PATCH(
      request('PATCH', '/api/v2/workflows/folders', {
        workspaceId: WORKSPACE_ID,
        path: '/Reports',
        destinationPath: '/Archive',
      })
    )

    expect(response.status).toBe(200)
    expect(mockRelocateFolderByPath).toHaveBeenCalledWith({
      resourceType: 'workflow',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      path: '/Reports',
      destinationPath: '/Archive',
    })
  })

  it('requires an explicit recursive delete choice', async () => {
    const missing = await DELETE(
      request('DELETE', `/api/v2/workflows/folders?workspaceId=${WORKSPACE_ID}&path=%2FReports`)
    )
    expect(missing.status).toBe(400)
    expect(mockDeleteFolderByPath).not.toHaveBeenCalled()

    const deleted = await DELETE(
      request(
        'DELETE',
        `/api/v2/workflows/folders?workspaceId=${WORKSPACE_ID}&path=%2FReports&recursive=true`
      )
    )
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({
      data: {
        path: '/Reports',
        deleted: true,
        deletedItems: { folders: 1, workflows: 2 },
      },
    })
  })
})
