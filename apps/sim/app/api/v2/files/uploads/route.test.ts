/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockAssertFolder,
  mockCreateUploadSession,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockAssertFolder: vi.fn(),
  mockCreateUploadSession: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileFolderTarget: mockAssertFolder,
}))

vi.mock('@/lib/uploads/multipart-session/service', () => ({
  createUploadSession: mockCreateUploadSession,
}))

import { POST } from '@/app/api/v2/files/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-03T22:00:00.000Z'),
}

function request(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/v2/files/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockAssertFolder.mockResolvedValue(null)
    mockCreateUploadSession.mockResolvedValue({
      id: 'upload-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      purpose: 'workspace_file',
      storageContext: 'workspace',
      storageKey: `${WORKSPACE_ID}/file.csv`,
      storageProvider: 's3',
      providerUploadId: 'provider-1',
      fileName: 'file.csv',
      contentType: 'text/csv',
      fileSize: 10,
      partSize: 8 * 1024 * 1024,
      partCount: 1,
      status: 'uploading',
      metadata: {},
      completedFileId: null,
      error: null,
      expiresAt: new Date('2026-08-04T21:00:00.000Z'),
      createdAt: new Date('2026-08-03T21:00:00.000Z'),
      updatedAt: new Date('2026-08-03T21:00:00.000Z'),
      completedAt: null,
    })
  })

  it('creates one durable multipart session for a small file', async () => {
    const response = await request({
      workspaceId: WORKSPACE_ID,
      name: 'file.csv',
      contentType: 'text/csv',
      size: 10,
    })

    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({
      id: 'upload-1',
      status: 'uploading',
      partCount: 1,
      file: null,
    })
    expect(mockCreateUploadSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      purpose: 'workspace_file',
      fileName: 'file.csv',
      contentType: 'text/csv',
      fileSize: 10,
      metadata: { folderId: null },
    })
  })

  it('authorizes workspace write access before creating provider state', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await request({
      workspaceId: WORKSPACE_ID,
      name: 'file.csv',
      contentType: 'text/csv',
      size: 10,
    })

    expect(response.status).toBe(403)
    expect(mockAssertFolder).not.toHaveBeenCalled()
    expect(mockCreateUploadSession).not.toHaveBeenCalled()
  })

  it('rejects an empty file before creating provider state', async () => {
    const response = await request({
      workspaceId: WORKSPACE_ID,
      name: 'file.csv',
      contentType: 'text/csv',
      size: 0,
    })

    expect(response.status).toBe(400)
    expect(mockResolveWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockCreateUploadSession).not.toHaveBeenCalled()
  })
})
