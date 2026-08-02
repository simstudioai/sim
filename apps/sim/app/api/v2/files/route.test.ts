/**
 * @vitest-environment node
 *
 * Public v2 files list/upload: gate ordering, the `scope` split that makes
 * Recently Deleted reachable, and folder-targeted upload.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockQueryWorkspaceFiles,
  mockUploadWorkspaceFile,
  mockGetWorkspaceFile,
  mockReadFormDataWithLimit,
  mockReadFileToBufferWithLimit,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockQueryWorkspaceFiles: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockReadFormDataWithLimit: vi.fn(),
  mockReadFileToBufferWithLimit: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  queryWorkspaceFiles: mockQueryWorkspaceFiles,
  workspaceFileCursorKeyCount: () => 2,
  uploadWorkspaceFile: mockUploadWorkspaceFile,
  getWorkspaceFile: mockGetWorkspaceFile,
  FileConflictError: class FileConflictError extends Error {},
}))

vi.mock('@/lib/core/utils/stream-limits', () => ({
  readFormDataWithLimit: mockReadFormDataWithLimit,
  readFileToBufferWithLimit: mockReadFileToBufferWithLimit,
  isPayloadSizeLimitError: () => false,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_UPLOADED: 'file.uploaded' },
  AuditResourceType: { FILE: 'file' },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
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
  scope: 'active',
  folderId: undefined,
  search: undefined,
  sortBy: 'uploadedAt',
  sortOrder: 'asc',
  limit: 100,
  after: undefined,
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files?${query}`))

const callUpload = (query: string) =>
  POST(
    new NextRequest(`http://localhost:3000/api/v2/files?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: 'x',
    })
  )

describe('GET /api/v2/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockQueryWorkspaceFiles.mockResolvedValue({ files: [buildRecord()], nextKeys: null })
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
        folderId: FOLDER_ID,
        folderPath: 'Reports/Q1',
        uploadedBy: 'user-1',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, DEFAULT_LIST_ARGS)
  })

  it('defaults to the active scope and passes archived through', async () => {
    await callList(`workspaceId=${WS}`)
    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, DEFAULT_LIST_ARGS)

    const archived = buildRecord({ id: 'wf_gone', name: 'gone.csv' })
    mockQueryWorkspaceFiles.mockResolvedValue({ files: [archived], nextKeys: null })

    const res = await callList(`workspaceId=${WS}&scope=archived`)
    const body = await res.json()

    expect(mockQueryWorkspaceFiles).toHaveBeenLastCalledWith(WS, {
      ...DEFAULT_LIST_ARGS,
      scope: 'archived',
    })
    expect(body.data.map((f: { id: string }) => f.id)).toEqual(['wf_gone'])
  })

  it('forwards search, folder, and sort into the query rather than filtering the result', async () => {
    await callList(
      `workspaceId=${WS}&search=report&folderId=${FOLDER_ID}&sortBy=name&sortOrder=desc`
    )

    expect(mockQueryWorkspaceFiles).toHaveBeenCalledWith(WS, {
      ...DEFAULT_LIST_ARGS,
      folderId: FOLDER_ID,
      search: 'report',
      sortBy: 'name',
      sortOrder: 'desc',
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
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockReadFileToBufferWithLimit.mockResolvedValue(Buffer.from('id,name\n'))
    mockUploadWorkspaceFile.mockResolvedValue({ id: 'wf_1' })
    mockGetWorkspaceFile.mockResolvedValue(buildRecord())

    const form = new FormData()
    form.set('file', new File(['id,name\n'], 'data.csv', { type: 'text/csv' }))
    mockReadFormDataWithLimit.mockResolvedValue(form)
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callUpload(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callUpload('folderId=fold_1')
    expect(res.status).toBe(400)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure before buffering the body', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callUpload(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockReadFormDataWithLimit).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callUpload(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('uploads to the workspace root and returns 201 with the stored record', async () => {
    const res = await callUpload(`workspaceId=${WS}`)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('wf_1')
    expect(body.data.folderId).toBeNull()
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      WS,
      'user-1',
      expect.any(Buffer),
      'data.csv',
      'text/csv',
      { folderId: null }
    )
  })

  it('lands the upload in the folder named by folderId', async () => {
    mockGetWorkspaceFile.mockResolvedValue(
      buildRecord({ folderId: FOLDER_ID, folderPath: 'Reports/Q1' })
    )

    const res = await callUpload(`workspaceId=${WS}&folderId=${FOLDER_ID}`)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      WS,
      'user-1',
      expect.any(Buffer),
      'data.csv',
      'text/csv',
      { folderId: FOLDER_ID }
    )
    expect(body.data.folderId).toBe(FOLDER_ID)
    expect(body.data.folderPath).toBe('Reports/Q1')
  })

  it('404s when the target folder does not exist', async () => {
    mockUploadWorkspaceFile.mockRejectedValue(
      new OrchestrationError('not_found', 'Target folder not found')
    )

    const res = await callUpload(`workspaceId=${WS}&folderId=missing`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('413s on a blown storage quota by class, not by message wording', async () => {
    mockUploadWorkspaceFile.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Quota exceeded for this workspace')
    )

    const res = await callUpload(`workspaceId=${WS}`)

    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('409s on a duplicate-name conflict by class', async () => {
    mockUploadWorkspaceFile.mockRejectedValue(
      new OrchestrationError('conflict', 'A file named "data.csv" already exists in this workspace')
    )

    const res = await callUpload(`workspaceId=${WS}`)

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })
})
