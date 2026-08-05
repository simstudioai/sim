/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockPerformCreateWorkspaceFile,
  mockQueryWorkspaceFiles,
  mockResolveWorkspaceAccess,
  mockV2ApiGateError,
  mockLoadActiveFolderPathIndex,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockPerformCreateWorkspaceFile: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockQueryWorkspaceFiles: vi.fn(),
  mockV2ApiGateError: vi.fn().mockResolvedValue(null),
  mockLoadActiveFolderPathIndex: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: mockV2ApiGateError,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  queryWorkspaceFiles: mockQueryWorkspaceFiles,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES: 70 * 1024 * 1024,
  performCreateWorkspaceFile: mockPerformCreateWorkspaceFile,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { GET, POST } from '@/app/api/v2/files/route'

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

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
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

/** What the route forwards for a bare `?workspaceId=` list. */
const DEFAULT_LIST_ARGS = {
  folderId: undefined,
  search: undefined,
  sortBy: 'uploadedAt',
  sortOrder: 'asc',
  limit: 100,
  after: undefined,
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files?${query}`))

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/v2/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/v2/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockQueryWorkspaceFiles.mockResolvedValue({ files: [buildRecord()], nextKeys: null })
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([['fold_1', { id: 'fold_1', name: 'Reports', parentId: null }]]),
      pathById: new Map([['fold_1', '/Reports']]),
      idByPath: new Map([
        ['/Reports', 'fold_1'],
        ['/Fixtures', 'fold_1'],
      ]),
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('limit=10')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s on a scope outside the enum', async () => {
    const res = await callList(`workspaceId=${WS}&scope=everything`)
    expect(res.status).toBe(400)
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public file shape including folder and updatedAt', async () => {
    mockQueryWorkspaceFiles.mockResolvedValue({
      files: [buildRecord({ folderId: FOLDER_ID, folderPath: 'Reports/Q1' })],
      nextKeys: null,
    })

    const res = await callList(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'wf_1',
        name: 'data.csv',
        size: 1024,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/Reports/Q1',
        uploadedBy: 'user-1',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, DEFAULT_LIST_ARGS)
  })

  it('lists active files only and rejects the removed archived scope', async () => {
    await callList(`workspaceId=${WS}`)
    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, DEFAULT_LIST_ARGS)

    const res = await callList(`workspaceId=${WS}&scope=archived`)
    expect(res.status).toBe(400)
  })

  it('forwards search, folder, and sort into the query rather than filtering the result', async () => {
    await callList(
      `workspaceId=${WS}&search=report&folderPath=${encodeURIComponent('/Reports')}&sortBy=name&sortOrder=desc`
    )

    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, {
      ...DEFAULT_LIST_ARGS,
      folderId: FOLDER_ID,
      search: 'report',
      sortBy: 'name',
      sortOrder: 'desc',
    })
  })

  it('treats folderPath=/ as root-only while omission lists every folder', async () => {
    await callList(`workspaceId=${WS}&folderPath=%2F`)

    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, {
      ...DEFAULT_LIST_ARGS,
      folderId: null,
    })
  })

  it('400s on a sort field outside the enum instead of passing it toward the query', async () => {
    const res = await callList(`workspaceId=${WS}&sortBy=name;DROP TABLE workspace_files`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=${WS}&search=`)

    expect(res.status).toBe(400)
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('emits a cursor stamped with the sort and resumes from its keys', async () => {
    mockQueryWorkspaceFiles.mockResolvedValue({
      files: [buildRecord()],
      nextKeys: ['data.csv', 'wf_1'],
    })

    const first = await callList(`workspaceId=${WS}&sortBy=name`)
    const { nextCursor } = await first.json()
    expect(nextCursor).not.toBeNull()

    await callList(`workspaceId=${WS}&sortBy=name&cursor=${encodeURIComponent(nextCursor)}`)

    expect(mockQueryWorkspaceFiles).toHaveBeenLastCalledWith(WS, {
      ...DEFAULT_LIST_ARGS,
      sortBy: 'name',
      after: ['data.csv', 'wf_1'],
    })
  })

  it('400s when a cursor is replayed under a different sort', async () => {
    mockQueryWorkspaceFiles.mockResolvedValue({
      files: [buildRecord()],
      nextKeys: ['data.csv', 'wf_1'],
    })

    const first = await callList(`workspaceId=${WS}&sortBy=name`)
    const { nextCursor } = await first.json()
    mockQueryWorkspaceFiles.mockClear()

    const res = await callList(
      `workspaceId=${WS}&sortBy=size&cursor=${encodeURIComponent(nextCursor)}`
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/cursor does not match/i)
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s on a malformed cursor instead of silently restarting from page one', async () => {
    const res = await callList(`workspaceId=${WS}&cursor=not-a-cursor`)

    expect(res.status).toBe(400)
    expect(mockQueryWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s when the cursor carries values the sort cannot hold', async () => {
    mockQueryWorkspaceFiles.mockRejectedValue(
      new OrchestrationError('validation', 'cursor does not match the requested sortBy/sortOrder.')
    )
    const cursor = Buffer.from(
      JSON.stringify({ sort: 'uploadedAt:asc', keys: ['not-a-date', 'wf_1'] })
    ).toString('base64')

    const res = await callList(`workspaceId=${WS}&cursor=${encodeURIComponent(cursor)}`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
  })

  it('terminates pagination when the query reports no further keys', async () => {
    mockQueryWorkspaceFiles.mockResolvedValue({ files: [buildRecord()], nextKeys: null })

    const res = await callList(`workspaceId=${WS}&search=data`)

    expect((await res.json()).nextCursor).toBeNull()
  })
})

describe('POST /api/v2/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockV2ApiGateError.mockResolvedValue(null)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformCreateWorkspaceFile.mockResolvedValue({
      success: true,
      file: buildRecord({ name: 'untitled.md', size: 0, type: 'text/markdown' }),
    })
  })

  it('creates an empty exact-name file with an inferred MIME type', async () => {
    const request = createRequest({ workspaceId: WS, name: 'untitled.md' })

    const response = await POST(request)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'wf_1', name: 'untitled.md', size: 0, type: 'text/markdown' },
    })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(RATE_LIMIT_OK, 'user-1', WS, 'write')
    expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      name: 'untitled.md',
      contentType: 'text/markdown',
      folderPath: '/',
      content: Buffer.alloc(0),
      exactName: true,
      request,
    })
  })

  it('decodes initialized base64 content before orchestration', async () => {
    mockPerformCreateWorkspaceFile.mockResolvedValue({
      success: true,
      file: buildRecord({
        name: 'seed.bin',
        size: 3,
        type: 'application/octet-stream',
        folderId: FOLDER_ID,
        folderPath: 'Fixtures',
      }),
    })
    const request = createRequest({
      workspaceId: WS,
      name: 'seed.bin',
      contentType: 'application/octet-stream',
      folderPath: '/Fixtures',
      content: Buffer.from([1, 2, 3]).toString('base64'),
      encoding: 'base64',
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        name: 'seed.bin',
        contentType: 'application/octet-stream',
        folderPath: '/Fixtures',
        content: Buffer.from([1, 2, 3]),
        exactName: true,
      })
    )
  })

  it('rejects malformed base64 before workspace access or orchestration', async () => {
    const response = await POST(
      createRequest({
        workspaceId: WS,
        name: 'seed.bin',
        content: 'not-base64!',
        encoding: 'base64',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BAD_REQUEST' },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('accepts empty base64 as a zero-byte file', async () => {
    const response = await POST(
      createRequest({ workspaceId: WS, name: 'empty.bin', content: '', encoding: 'base64' })
    )

    expect(response.status).toBe(201)
    expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: Buffer.alloc(0) })
    )
  })

  it('returns the canonical v2 envelope when the JSON body exceeds the inline limit', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_WORKSPACE_FILE_INLINE_BODY_BYTES + 1),
      },
      body: '{}',
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the canonical v2 envelope for malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON' },
    })
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'name conflict',
      result: {
        success: false,
        error: 'A file with this name already exists',
        errorCode: 'conflict',
      },
      status: 409,
      code: 'CONFLICT',
      message: 'A file with this name already exists',
    },
    {
      label: 'internal orchestration failure',
      result: { success: false, error: 'database connection details', errorCode: 'internal' },
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  ])('maps a $label into the v2 error envelope', async ({ result, status, code, message }) => {
    mockPerformCreateWorkspaceFile.mockResolvedValue(result)

    const response = await POST(createRequest({ workspaceId: WS, name: 'untitled.md' }))

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error: { code, message } })
  })

  it('returns the auth failure before gating, access checks, or orchestration', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: 'Invalid API key',
      limit: 100,
      remaining: 0,
      resetAt: RATE_LIMIT_OK.resetAt,
    })

    const response = await POST(createRequest({ workspaceId: WS, name: 'untitled.md' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
    })
    expect(mockV2ApiGateError).not.toHaveBeenCalled()
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the v2 gate failure before access checks or orchestration', async () => {
    const { v2Error } = await import('@/app/api/v2/lib/response')
    mockV2ApiGateError.mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const response = await POST(createRequest({ workspaceId: WS, name: 'untitled.md' }))

    expect(response.status).toBe(404)
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('requires workspace write access before orchestration', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await POST(createRequest({ workspaceId: WS, name: 'untitled.md' }))

    expect(response.status).toBe(403)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(RATE_LIMIT_OK, 'user-1', WS, 'write')
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })
})
