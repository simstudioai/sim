/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockLocalUploadBodyError, mockGetOwnedUploadSession, mockMetadata, mockWriteLocalPut } =
  vi.hoisted(() => {
    class MockLocalUploadBodyError extends Error {}
    return {
      MockLocalUploadBodyError,
      mockGetOwnedUploadSession: vi.fn(),
      mockMetadata: vi.fn(),
      mockWriteLocalPut: vi.fn(),
    }
  })

vi.mock('@/lib/uploads/upload-session/provider', () => ({
  LocalUploadBodyError: MockLocalUploadBodyError,
  writeLocalPutObject: mockWriteLocalPut,
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  getOwnedUploadSession: mockGetOwnedUploadSession,
  uploadSessionObjectMetadata: mockMetadata,
}))

import { PUT } from '@/app/api/v2/uploads/[uploadId]/route'

const SESSION = {
  id: 'upload-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  knowledgeBaseId: null,
  workflowId: null,
  executionId: null,
  purpose: 'workspace_file',
  method: 'put',
  storageContext: 'workspace',
  storageKey: 'workspace/workspace-1/file.bin',
  finalKey: 'workspace/workspace-1/file.bin',
  storageProvider: 'local',
  providerUploadId: null,
  providerObjectVersion: null,
  fileName: 'file.bin',
  contentType: 'application/octet-stream',
  fileSize: 3,
  partSize: null,
  partCount: null,
  status: 'uploading',
  metadata: {},
  uploadToken: 'signed-token',
  createdAt: new Date('2026-08-04T12:00:00.000Z'),
  expiresAt: new Date('2099-08-05T12:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: new Date('2026-08-04T12:00:00.000Z'),
} as const

describe('PUT /api/v2/uploads/[uploadId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOwnedUploadSession.mockReturnValue(SESSION)
    mockMetadata.mockReturnValue({ uploadId: 'upload-1', purpose: 'workspace_file' })
    mockWriteLocalPut.mockResolvedValue(undefined)
  })

  it('streams the local PUT with the signed session size and canonical metadata', async () => {
    const response = await request()

    expect(response.status).toBe(204)
    expect(mockGetOwnedUploadSession).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      uploadToken: 'signed-token',
    })
    expect(mockWriteLocalPut).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      body: expect.any(ReadableStream),
      expectedSize: 3,
      contentType: 'application/octet-stream',
      metadata: { uploadId: 'upload-1', purpose: 'workspace_file' },
    })
  })

  it('streams an empty local PUT body for an empty workspace-file session', async () => {
    mockGetOwnedUploadSession.mockReturnValue({ ...SESSION, fileSize: 0 })
    const response = await request({ contentLength: '0', body: new Uint8Array() })

    expect(response.status).toBe(204)
    expect(mockWriteLocalPut).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSize: 0, body: expect.any(ReadableStream) })
    )
  })

  it('rejects a mismatched Content-Length before opening the local writer', async () => {
    const response = await request({ contentLength: '2' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Upload must contain exactly 3 bytes' },
    })
    expect(mockWriteLocalPut).not.toHaveBeenCalled()
  })

  /**
   * This route is deliberately absent from the OpenAPI documents, which is a
   * statement about addressability rather than about behaviour. It used to
   * answer with a bare `{ error: string }`, which made the one step of an
   * upload that actually moves the bytes the one step a caller could not parse
   * with its v2 error handling.
   */
  it('rejects a URL whose token names a non-local or multipart session, in the v2 envelope', async () => {
    mockGetOwnedUploadSession.mockReturnValue({ ...SESSION, method: 'multipart' })

    const response = await request()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Upload URL does not match this session' },
    })
    expect(mockWriteLocalPut).not.toHaveBeenCalled()
  })

  it('maps exact-size streaming failures to a caller error', async () => {
    mockWriteLocalPut.mockRejectedValue(new MockLocalUploadBodyError('Upload exceeds 3 bytes'))

    const response = await request({ contentLength: null })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Upload exceeds 3 bytes' },
    })
  })
})

function request(options?: { contentLength?: string | null; body?: Uint8Array }) {
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'upload-token': 'signed-token',
  })
  if (options?.contentLength !== null) {
    headers.set('Content-Length', options?.contentLength ?? '3')
  }
  return PUT(
    new NextRequest('http://localhost:3000/api/v2/uploads/upload-1', {
      method: 'PUT',
      headers,
      body: options?.body ?? new Uint8Array([1, 2, 3]),
    }),
    { params: Promise.resolve({ uploadId: 'upload-1' }) }
  )
}
