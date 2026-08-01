/**
 * @vitest-environment node
 *
 * Public v2 folders list/create: gate ordering, the required-`resourceType`
 * departure from the internal default, and the lock check on create.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockListFoldersForWorkspace,
  mockCreateFolder,
  mockAssertFolderMutable,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockListFoldersForWorkspace: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockAssertFolderMutable: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/folders/queries', () => ({
  listFoldersForWorkspace: mockListFoldersForWorkspace,
}))

vi.mock('@/lib/folders/lifecycle', () => ({
  createFolder: mockCreateFolder,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mockAssertFolderMutable,
  FolderLockedError: class FolderLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/folders/route'

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

const FOLDER_API = {
  id: 'fld_abc123',
  resourceType: 'workflow' as const,
  name: 'Onboarding',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  parentId: null,
  locked: false,
  sortOrder: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  deletedAt: null,
}

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

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/folders?${query}`))

function callCreate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_BODY = {
  workspaceId: 'workspace-1',
  resourceType: 'workflow',
  name: 'Onboarding',
}

describe('GET /api/v2/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListFoldersForWorkspace.mockResolvedValue([FOLDER_API])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList('workspaceId=workspace-1&resourceType=workflow')

    expect(res.status).toBe(404)
    expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('resourceType=workflow')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
  })

  it('400s when resourceType is omitted instead of defaulting to workflow', async () => {
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(400)
    expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
  })

  it('400s on a resourceType outside the served set', async () => {
    const res = await callList('workspaceId=workspace-1&resourceType=file')
    expect(res.status).toBe(400)
    expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList('workspaceId=workspace-1&resourceType=workflow')
    expect(res.status).toBe(403)
    expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList('workspaceId=workspace-1&resourceType=workflow')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public folder shape without internal scoping columns', async () => {
    const res = await callList('workspaceId=workspace-1&resourceType=workflow')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'fld_abc123',
        resourceType: 'workflow',
        name: 'Onboarding',
        parentId: null,
        locked: false,
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    ])
    expect(mockListFoldersForWorkspace).toHaveBeenCalledWith('workspace-1', 'active', 'workflow')
  })

  it('passes the archived scope through', async () => {
    await callList('workspaceId=workspace-1&resourceType=table&scope=archived')
    expect(mockListFoldersForWorkspace).toHaveBeenCalledWith('workspace-1', 'archived', 'table')
  })
})

describe('POST /api/v2/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockCreateFolder.mockResolvedValue({ success: true, folder: buildRow() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockCreateFolder).not.toHaveBeenCalled()
  })

  it('400s when the name is empty', async () => {
    const res = await callCreate({ ...VALID_BODY, name: '   ' })
    expect(res.status).toBe(400)
    expect(mockCreateFolder).not.toHaveBeenCalled()
  })

  it('400s when resourceType is omitted', async () => {
    const res = await callCreate({ workspaceId: 'workspace-1', name: 'Onboarding' })
    expect(res.status).toBe(400)
    expect(mockCreateFolder).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockCreateFolder).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('409s when a sibling folder already has the name', async () => {
    mockCreateFolder.mockResolvedValue({
      success: false,
      error: 'A folder with this name already exists in this location',
      errorCode: 'conflict',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('creates the folder and returns 201', async () => {
    const res = await callCreate({ ...VALID_BODY, parentId: null })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.folder).toMatchObject({ id: 'fld_abc123', name: 'Onboarding' })
    expect(body.data.folder.userId).toBeUndefined()
    expect(mockCreateFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'workflow',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        name: 'Onboarding',
      })
    )
  })
})
