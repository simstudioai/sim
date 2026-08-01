/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformRestore } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockPerformRestore: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performRestoreWorkspaceFileFolder: mockPerformRestore,
}))

import { POST } from '@/app/api/v2/files/folders/[folderId]/restore/route'

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
  name: 'Q1',
  parentId: null,
  path: 'Q1',
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
}

const callRestore = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost:3000/api/v2/files/folders/${FOLDER_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ folderId: FOLDER_ID }) }
  )

describe('POST /api/v2/files/folders/[folderId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformRestore.mockResolvedValue({
      success: true,
      folder: FOLDER,
      restoredItems: { files: 3, folders: 1 },
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callRestore({ workspaceId: WS })

    expect(res.status).toBe(404)
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callRestore({})
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callRestore({ workspaceId: WS })
    expect(res.status).toBe(403)
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callRestore({ workspaceId: WS })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('restores the folder and its subtree', async () => {
    const res = await callRestore({ workspaceId: WS })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      folder: {
        id: FOLDER_ID,
        name: 'Q1',
        parentId: null,
        path: 'Q1',
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        deletedAt: null,
      },
      restoredItems: { files: 3, folders: 1 },
    })
    expect(mockPerformRestore).toHaveBeenCalledWith({
      workspaceId: WS,
      folderId: FOLDER_ID,
      userId: 'user-1',
    })
  })

  it('maps a conflict errorCode to 409 when the name is taken again', async () => {
    mockPerformRestore.mockResolvedValue({
      success: false,
      error: 'A folder with this name already exists in this location',
      errorCode: 'conflict',
    })

    const res = await callRestore({ workspaceId: WS })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })
})
