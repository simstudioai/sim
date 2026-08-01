/**
 * @vitest-environment node
 *
 * Public v2 file folders. These are a separate surface from `/api/v2/folders`
 * on purpose, so the name rules the generic folder engine does not enforce
 * (path separators, dot segments) are pinned here.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockListFolders, mockPerformCreate } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockListFolders: vi.fn(),
    mockPerformCreate: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFileFolders: mockListFolders,
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performCreateWorkspaceFileFolder: mockPerformCreate,
}))

import { GET, POST } from '@/app/api/v2/files/folders/route'

const WS = 'workspace-1'

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

function buildFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fold_1',
    workspaceId: WS,
    userId: 'user-1',
    name: 'Q1',
    parentId: null,
    path: 'Q1',
    sortOrder: 0,
    deletedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files/folders?${query}`))

const callCreate = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/v2/files/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('GET /api/v2/files/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListFolders.mockResolvedValue([buildFolder()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect(mockListFolders).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('scope=active')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListFolders).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockListFolders).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public folder shape without internal scoping columns', async () => {
    const res = await callList(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'fold_1',
        name: 'Q1',
        parentId: null,
        path: 'Q1',
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    ])
    expect(mockListFolders).toHaveBeenCalledWith(WS, { scope: 'active' })
  })

  it('passes scope=archived through to the manager', async () => {
    mockListFolders.mockResolvedValue([
      buildFolder({ id: 'fold_gone', deletedAt: new Date('2024-02-01T00:00:00Z') }),
    ])

    const res = await callList(`workspaceId=${WS}&scope=archived`)
    const body = await res.json()

    expect(mockListFolders).toHaveBeenCalledWith(WS, { scope: 'archived' })
    expect(body.data[0].deletedAt).toBe('2024-02-01T00:00:00.000Z')
  })
})

describe('POST /api/v2/files/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformCreate.mockResolvedValue({ success: true, folder: buildFolder() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate({ workspaceId: WS, name: 'Q1' })

    expect(res.status).toBe(404)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('400s when name is missing', async () => {
    const res = await callCreate({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('400s on a name containing a path separator or a dot segment', async () => {
    for (const name of ['Reports/Q1', 'Reports\\Q1', '..', '.']) {
      const res = await callCreate({ workspaceId: WS, name })
      expect(res.status).toBe(400)
    }
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate({ workspaceId: WS, name: 'Q1' })
    expect(res.status).toBe(403)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callCreate({ workspaceId: WS, name: 'Q1' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('creates the folder and returns 201', async () => {
    const res = await callCreate({ workspaceId: WS, name: 'Q1' })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('fold_1')
    expect(body.data).not.toHaveProperty('workspaceId')
    expect(body.data).not.toHaveProperty('userId')
    expect(mockPerformCreate).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      name: 'Q1',
      parentId: null,
    })
  })

  it('maps a conflict errorCode to 409', async () => {
    mockPerformCreate.mockResolvedValue({
      success: false,
      error: 'A folder named "Q1" already exists in this location',
      errorCode: 'conflict',
    })

    const res = await callCreate({ workspaceId: WS, name: 'Q1' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })
})
