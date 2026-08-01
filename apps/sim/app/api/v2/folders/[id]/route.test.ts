/**
 * @vitest-environment node
 *
 * Public v2 folder detail: the archived-row split between PATCH and DELETE, the
 * admin gate on `locked`, and the 423 a mutation lock produces.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockFindActiveFolder,
  mockFindFolderInWorkspace,
  mockUpdateFolder,
  mockDeleteFolder,
  mockAssertFolderMutable,
  FolderLockedErrorMock,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockFindFolderInWorkspace: vi.fn(),
  mockUpdateFolder: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockAssertFolderMutable: vi.fn(),
  FolderLockedErrorMock: class FolderLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/folders/queries', () => ({
  findActiveFolder: mockFindActiveFolder,
  findFolderInWorkspace: mockFindFolderInWorkspace,
}))

vi.mock('@/lib/folders/lifecycle', () => ({
  updateFolder: mockUpdateFolder,
  deleteFolder: mockDeleteFolder,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mockAssertFolderMutable,
  FolderLockedError: FolderLockedErrorMock,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/folders/[id]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fld_abc123',
    resourceType: 'workflow',
    name: 'Onboarding',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    parentId: null,
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

const routeContext = () => ({ params: Promise.resolve({ id: 'fld_abc123' }) })
const url = (query = 'workspaceId=workspace-1&resourceType=workflow') =>
  `http://localhost:3000/api/v2/folders/fld_abc123?${query}`

const callGet = (query?: string) => GET(new NextRequest(url(query)), routeContext())
const callDelete = (query?: string) =>
  DELETE(new NextRequest(url(query), { method: 'DELETE' }), routeContext())

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/folders/fld_abc123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

describe('GET /api/v2/folders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockFindFolderInWorkspace.mockResolvedValue(buildRow())
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockFindFolderInWorkspace).not.toHaveBeenCalled()
  })

  it('400s when resourceType is missing', async () => {
    const res = await callGet('workspaceId=workspace-1')
    expect(res.status).toBe(400)
    expect(mockFindFolderInWorkspace).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mockFindFolderInWorkspace).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the folder is not in this workspace tree', async () => {
    mockFindFolderInWorkspace.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the public folder shape', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.folder).toEqual({
      id: 'fld_abc123',
      resourceType: 'workflow',
      name: 'Onboarding',
      parentId: null,
      locked: false,
      sortOrder: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deletedAt: null,
    })
    expect(mockFindFolderInWorkspace).toHaveBeenCalledWith('fld_abc123', 'workspace-1', 'workflow')
  })
})

describe('PATCH /api/v2/folders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockFindActiveFolder.mockResolvedValue(buildRow())
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockUpdateFolder.mockResolvedValue({ success: true, folder: buildRow({ name: 'Renamed' }) })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })

    expect(res.status).toBe(404)
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('400s when no field to change is supplied', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', resourceType: 'workflow' })
    expect(res.status).toBe(400)
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })
    expect(res.status).toBe(403)
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('requires only write permission for an ordinary rename', async () => {
    await callPatch({ workspaceId: 'workspace-1', resourceType: 'workflow', name: 'Renamed' })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'workspace-1',
      'write'
    )
  })

  it('escalates to admin when locked is being set', async () => {
    await callPatch({ workspaceId: 'workspace-1', resourceType: 'workflow', locked: true })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'workspace-1',
      'admin'
    )
  })

  it('400s when locked is sent for a tree that does not support locking', async () => {
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'table',
      locked: true,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('workflow folders')
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('404s on an archived folder so a locked subtree cannot be edited through it', async () => {
    mockFindActiveFolder.mockResolvedValue(null)
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })
    expect(res.status).toBe(404)
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('423s when a mutation lock blocks the change', async () => {
    mockAssertFolderMutable.mockRejectedValue(new FolderLockedErrorMock('Folder is locked'))
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
    expect(mockUpdateFolder).not.toHaveBeenCalled()
  })

  it('updates the folder and returns the public shape', async () => {
    const res = await callPatch({
      workspaceId: 'workspace-1',
      resourceType: 'workflow',
      name: 'Renamed',
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.folder.name).toBe('Renamed')
    expect(mockUpdateFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'workflow',
        folderId: 'fld_abc123',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Renamed',
      })
    )
  })
})

describe('DELETE /api/v2/folders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockFindFolderInWorkspace.mockResolvedValue(buildRow())
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockDeleteFolder.mockResolvedValue({
      success: true,
      deletedItems: { folders: 2, workflows: 5 },
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockDeleteFolder).not.toHaveBeenCalled()
  })

  it('400s when resourceType is missing', async () => {
    const res = await callDelete('workspaceId=workspace-1')
    expect(res.status).toBe(400)
    expect(mockDeleteFolder).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(403)
    expect(mockDeleteFolder).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the folder is not in this workspace tree', async () => {
    mockFindFolderInWorkspace.mockResolvedValue(null)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockDeleteFolder).not.toHaveBeenCalled()
  })

  it('423s when a mutation lock blocks the delete', async () => {
    mockAssertFolderMutable.mockRejectedValue(new FolderLockedErrorMock('Folder is locked'))
    const res = await callDelete()
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
    expect(mockDeleteFolder).not.toHaveBeenCalled()
  })

  it('deletes the folder and reports the cascade counts', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { id: 'fld_abc123', deleted: true, deletedItems: { folders: 2, workflows: 5 } },
    })
    expect(mockDeleteFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'workflow',
        folderId: 'fld_abc123',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        folderName: 'Onboarding',
      })
    )
  })
})
