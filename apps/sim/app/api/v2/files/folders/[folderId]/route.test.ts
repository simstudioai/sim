/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformUpdate, mockPerformDelete } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockPerformUpdate: vi.fn(),
    mockPerformDelete: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performUpdateWorkspaceFileFolder: mockPerformUpdate,
  performDeleteWorkspaceFileItems: mockPerformDelete,
}))

import { DELETE, PATCH } from '@/app/api/v2/files/folders/[folderId]/route'

const WS = 'workspace-1'
const FOLDER_ID = 'fold_1'

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

const FOLDER = {
  id: FOLDER_ID,
  workspaceId: WS,
  userId: 'user-1',
  name: 'Q2',
  parentId: null,
  path: 'Q2',
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
}

const ctx = { params: Promise.resolve({ folderId: FOLDER_ID }) }

const callPatch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost:3000/api/v2/files/folders/${FOLDER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx
  )

const callDelete = (query: string) =>
  DELETE(new NextRequest(`http://localhost:3000/api/v2/files/folders/${FOLDER_ID}?${query}`), ctx)

describe('PATCH /api/v2/files/folders/[folderId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformUpdate.mockResolvedValue({ success: true, folder: FOLDER })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ workspaceId: WS, name: 'Q2' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdate).not.toHaveBeenCalled()
  })

  it('400s when no updatable field is supplied', async () => {
    const res = await callPatch({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpdate).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callPatch({ workspaceId: WS, name: 'Q2' })
    expect(res.status).toBe(403)
    expect(mockPerformUpdate).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ workspaceId: WS, name: 'Q2' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('renames the folder and returns the public shape', async () => {
    const res = await callPatch({ workspaceId: WS, name: 'Q2' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: FOLDER_ID,
      name: 'Q2',
      parentId: null,
      path: 'Q2',
      sortOrder: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deletedAt: null,
    })
    expect(mockPerformUpdate).toHaveBeenCalledWith({
      workspaceId: WS,
      folderId: FOLDER_ID,
      userId: 'user-1',
      name: 'Q2',
      parentId: undefined,
      sortOrder: undefined,
    })
  })

  it('maps a validation errorCode (e.g. a reparent cycle) to 400', async () => {
    mockPerformUpdate.mockResolvedValue({
      success: false,
      error: 'A folder cannot be moved into its own descendant',
      errorCode: 'validation',
    })

    const res = await callPatch({ workspaceId: WS, parentId: 'fold_child' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toContain('descendant')
  })
})

describe('DELETE /api/v2/files/folders/[folderId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformDelete.mockResolvedValue({ success: true, deletedItems: { files: 3, folders: 1 } })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDelete('')
    expect(res.status).toBe(400)
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callDelete(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('archives the folder and reports the cascade', async () => {
    const res = await callDelete(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: FOLDER_ID,
      deleted: true,
      deletedItems: { files: 3, folders: 1 },
    })
    expect(mockPerformDelete).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      folderIds: [FOLDER_ID],
      request: expect.anything(),
    })
  })

  it('maps a not_found errorCode to 404', async () => {
    mockPerformDelete.mockResolvedValue({
      success: false,
      error: 'Folder not found',
      errorCode: 'not_found',
    })

    const res = await callDelete(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
