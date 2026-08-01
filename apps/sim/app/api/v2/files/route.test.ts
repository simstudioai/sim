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
  mockListWorkspaceFiles,
  mockUploadWorkspaceFile,
  mockGetWorkspaceFile,
  mockReadFormDataWithLimit,
  mockReadFileToBufferWithLimit,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
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
  listWorkspaceFiles: mockListWorkspaceFiles,
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
    mockListWorkspaceFiles.mockResolvedValue([buildRecord()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList(`workspaceId=${WS}`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('limit=10')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('400s on a scope outside the enum', async () => {
    const res = await callList(`workspaceId=${WS}&scope=everything`)
    expect(res.status).toBe(400)
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(403)
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList(`workspaceId=${WS}`)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public file shape including folder and updatedAt', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      buildRecord({ folderId: FOLDER_ID, folderPath: 'Reports/Q1' }),
    ])

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
    expect(mockListWorkspaceFiles).toHaveBeenCalledWith(WS, { scope: 'active' })
  })

  it('defaults to the active scope and passes archived through', async () => {
    await callList(`workspaceId=${WS}`)
    expect(mockListWorkspaceFiles).toHaveBeenCalledWith(WS, { scope: 'active' })

    const archived = buildRecord({ id: 'wf_gone', name: 'gone.csv' })
    mockListWorkspaceFiles.mockResolvedValue([archived])

    const res = await callList(`workspaceId=${WS}&scope=archived`)
    const body = await res.json()

    expect(mockListWorkspaceFiles).toHaveBeenLastCalledWith(WS, { scope: 'archived' })
    expect(body.data.map((f: { id: string }) => f.id)).toEqual(['wf_gone'])
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
    mockUploadWorkspaceFile.mockRejectedValue(new Error('Target folder not found'))

    const res = await callUpload(`workspaceId=${WS}&folderId=missing`)

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
