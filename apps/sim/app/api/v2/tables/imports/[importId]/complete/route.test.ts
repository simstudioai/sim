/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockGetOwnedTableImportUpload,
  mockFindOwnedTableImport,
  mockStartUploadedTableImport,
  mockToV2TableImport,
  mockCompleteUploadSession,
  mockValidateUploadCompletion,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockGetOwnedTableImportUpload: vi.fn(),
  mockFindOwnedTableImport: vi.fn(),
  mockStartUploadedTableImport: vi.fn(),
  mockToV2TableImport: vi.fn(),
  mockCompleteUploadSession: vi.fn(),
  mockValidateUploadCompletion: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/v2/tables/utils', () => ({
  v2TableLockError: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/table/orchestration/import-resource', () => ({
  findOwnedTableImport: mockFindOwnedTableImport,
  getOwnedTableImportUpload: mockGetOwnedTableImportUpload,
  startUploadedTableImport: mockStartUploadedTableImport,
  toV2TableImport: mockToV2TableImport,
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  completeUploadSession: mockCompleteUploadSession,
  validateUploadCompletion: mockValidateUploadCompletion,
}))

import { POST } from '@/app/api/v2/tables/imports/[importId]/complete/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-03T22:00:00.000Z'),
}
const UPLOAD = {
  id: 'import-1',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
}

function request(body: Record<string, unknown> = { parts: [{ partNumber: 1, etag: 'etag-1' }] }) {
  return POST(
    new NextRequest(
      `http://localhost:3000/api/v2/tables/imports/import-1/complete?workspaceId=${WORKSPACE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'upload-token': 'signed-upload-token',
        },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ importId: 'import-1' }) }
  )
}

describe('POST /api/v2/tables/imports/[importId]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockGetOwnedTableImportUpload.mockReturnValue(UPLOAD)
  })

  it('returns the existing table job when completion is retried', async () => {
    const existing = { id: 'import-1', tableId: 'table-1', status: 'ready' }
    const responseBody = { id: 'import-1', tableId: 'table-1', status: 'completed' }
    mockFindOwnedTableImport.mockResolvedValue(existing)
    mockToV2TableImport.mockReturnValue(responseBody)

    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: responseBody })
    expect(mockGetOwnedTableImportUpload).toHaveBeenCalledWith({
      importId: 'import-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      uploadToken: 'signed-upload-token',
    })
    expect(mockFindOwnedTableImport).toHaveBeenCalledWith({
      importId: 'import-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
    })
    expect(mockValidateUploadCompletion).toHaveBeenCalledWith(UPLOAD, {
      parts: [{ partNumber: 1, etag: 'etag-1' }],
    })
    expect(mockCompleteUploadSession).not.toHaveBeenCalled()
    expect(mockStartUploadedTableImport).not.toHaveBeenCalled()
  })

  it('validates completion shape before returning an existing table job', async () => {
    mockFindOwnedTableImport.mockResolvedValue({ id: 'import-1' })
    mockValidateUploadCompletion.mockImplementationOnce(() => {
      throw new OrchestrationError('validation', 'Multipart completion requires parts')
    })

    const response = await request({})

    expect(response.status).toBe(400)
    expect(mockFindOwnedTableImport).not.toHaveBeenCalled()
    expect(mockCompleteUploadSession).not.toHaveBeenCalled()
  })

  it.each([
    ['PUT', {}],
    ['multipart', { parts: [{ partNumber: 1, etag: 'etag-1' }] }],
  ])('forwards a %s completion body and starts the import job', async (_method, completion) => {
    const started = { id: 'import-1', tableId: 'table-1', status: 'running' }
    const responseBody = { id: 'import-1', tableId: 'table-1', status: 'processing' }
    mockFindOwnedTableImport.mockResolvedValue(null)
    mockCompleteUploadSession.mockResolvedValue({
      session: UPLOAD,
      value: null,
      alreadyCompleted: false,
    })
    mockStartUploadedTableImport.mockResolvedValue(started)
    mockToV2TableImport.mockReturnValue(responseBody)

    const response = await request(completion)

    expect(response.status).toBe(200)
    expect(mockCompleteUploadSession).toHaveBeenCalledWith({
      session: UPLOAD,
      completion,
      finalize: expect.any(Function),
    })
    expect(mockStartUploadedTableImport).toHaveBeenCalledWith(UPLOAD)
    expect(await response.json()).toEqual({ data: responseBody })
  })
})
