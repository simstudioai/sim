/**
 * @vitest-environment node
 *
 * Public v2 file detail: download, rename, archive. Covers the orchestration
 * error mapping that replaced the route-local status switch.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetWorkspaceFile,
  mockFetchWorkspaceFileBuffer,
  mockPerformRename,
  mockPerformDelete,
  mockGetUserEmailsByIds,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockPerformRename: vi.fn(),
  mockPerformDelete: vi.fn(),
  mockGetUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mockGetUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performRenameWorkspaceFile: mockPerformRename,
  performDeleteWorkspaceFileItems: mockPerformDelete,
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/files/[fileId]/route'

const WS = 'workspace-1'
const FILE_ID = 'wf_1'

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

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WS,
    name: 'data.csv',
    key: 'workspace/ws/1-x-data.csv',
    path: '/api/files/serve/x',
    size: 1024,
    type: 'text/csv',
    uploadedBy: 'user-1',
    folderId: null,
    folderPath: null,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const ctx = { params: Promise.resolve({ fileId: FILE_ID }) }

const callDownload = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?${query}`), ctx)

const callRename = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx
  )

const callDelete = (query: string) =>
  DELETE(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?${query}`), ctx)

describe('GET /api/v2/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceFile.mockResolvedValue(buildRecord())
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('id,name\n'))
    mockGetUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDownload(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDownload('')
    expect(res.status).toBe(400)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callDownload(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDownload(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('streams the bytes with rate-limit headers', async () => {
    const res = await callDownload(`workspaceId=${WS}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(await res.text()).toBe('id,name\n')
  })
})

describe('PATCH /api/v2/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformRename.mockResolvedValue({
      success: true,
      file: buildRecord({ name: 'renamed.csv' }),
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })

    expect(res.status).toBe(404)
    expect(mockPerformRename).not.toHaveBeenCalled()
  })

  it('400s on a name containing a path separator', async () => {
    const res = await callRename({ workspaceId: WS, name: 'nested/renamed.csv' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformRename).not.toHaveBeenCalled()
  })

  it('400s on an unknown body field', async () => {
    const res = await callRename({ workspaceId: WS, name: 'renamed.csv', folderId: 'fold_1' })
    expect(res.status).toBe(400)
    expect(mockPerformRename).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })
    expect(res.status).toBe(403)
    expect(mockPerformRename).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('renames and returns the public file shape', async () => {
    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: FILE_ID,
      name: 'renamed.csv',
      size: 1024,
      type: 'text/csv',
      key: 'workspace/ws/1-x-data.csv',
      folderPath: '/',
      uploadedByEmail: 'ada@example.com',
      uploadedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    })
    expect(mockPerformRename).toHaveBeenCalledWith({
      workspaceId: WS,
      fileId: FILE_ID,
      name: 'renamed.csv',
      userId: 'user-1',
    })
  })

  it('maps a conflict errorCode to 409 through the shared mapper', async () => {
    mockPerformRename.mockResolvedValue({
      success: false,
      error: 'A file named "renamed.csv" already exists in this workspace',
      errorCode: 'conflict',
    })

    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toContain('already exists')
  })

  it('hides an unclassified failure behind a generic 500', async () => {
    mockPerformRename.mockResolvedValue({
      success: false,
      error: 'update "workspace_files" set ... failed',
      errorCode: 'internal',
    })

    const res = await callRename({ workspaceId: WS, name: 'renamed.csv' })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.message).toBe('Internal server error')
  })
})

describe('DELETE /api/v2/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformDelete.mockResolvedValue({ success: true, deletedItems: { files: 1, folders: 0 } })
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

  it('archives the file and acknowledges', async () => {
    const res = await callDelete(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: FILE_ID, deleted: true })
    expect(mockPerformDelete).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      fileIds: [FILE_ID],
      request: expect.anything(),
    })
  })

  it('maps a not_found errorCode to 404', async () => {
    mockPerformDelete.mockResolvedValue({
      success: false,
      error: 'File not found',
      errorCode: 'not_found',
    })

    const res = await callDelete(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
