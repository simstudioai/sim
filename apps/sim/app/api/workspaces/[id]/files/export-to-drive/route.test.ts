/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockListWorkspaceFiles,
  mockFetchWorkspaceFileBuffer,
  mockRefreshAccessTokenIfNeeded,
  mockUploadBufferToDrive,
  mockVerifyWorkspaceMembership,
} = vi.hoisted(() => ({
  mockListWorkspaceFiles: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockUploadBufferToDrive: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

vi.mock('@/lib/google-drive/upload-to-drive', () => ({
  uploadBufferToDrive: mockUploadBufferToDrive,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'

import { POST } from '@/app/api/workspaces/[id]/files/export-to-drive/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

const makeRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/export-to-drive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const fileRecord = (id: string, name: string, type = 'application/pdf') => ({
  id,
  name,
  type,
  key: `workspace/${WS}/${id}-${name}`,
  storageContext: 'workspace',
})

const validBody = { fileIds: ['file-1', 'file-2'], credentialId: 'cred-1' }

describe('POST /api/workspaces/[id]/files/export-to-drive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue('read')
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockListWorkspaceFiles.mockResolvedValue([
      fileRecord('file-1', 'a.pdf'),
      fileRecord('file-2', 'b.pdf'),
    ])
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('content'))
    mockUploadBufferToDrive.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({ id: `drive-${name}`, name, webViewLink: `https://drive/${name}` })
    )
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(401)
    expect(mockUploadBufferToDrive).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not a workspace member', async () => {
    mockVerifyWorkspaceMembership.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(403)
    expect(mockUploadBufferToDrive).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is invalid (no files selected)', async () => {
    const res = await POST(makeRequest({ fileIds: [], credentialId: 'cred-1' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when the Google Drive token cannot be resolved', async () => {
    mockRefreshAccessTokenIfNeeded.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('not connected')
    expect(mockUploadBufferToDrive).not.toHaveBeenCalled()
  })

  it('returns 400 when none of the requested files exist', async () => {
    mockListWorkspaceFiles.mockResolvedValueOnce([fileRecord('other', 'x.pdf')])
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(400)
    expect(mockUploadBufferToDrive).not.toHaveBeenCalled()
  })

  it('exports all matching files and returns success', async () => {
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.exported).toHaveLength(2)
    expect(body.failed).toHaveLength(0)
    expect(body.exported[0]).toMatchObject({ fileId: 'file-1', driveFileId: 'drive-a.pdf' })
    expect(mockUploadBufferToDrive).toHaveBeenCalledTimes(2)
  })

  it('reports partial failure without aborting the batch', async () => {
    mockUploadBufferToDrive
      .mockResolvedValueOnce({ id: 'drive-a', name: 'a.pdf', webViewLink: 'https://drive/a' })
      .mockRejectedValueOnce(new Error('Drive quota exceeded'))
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.exported).toHaveLength(1)
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0]).toMatchObject({ fileId: 'file-2', error: 'Drive quota exceeded' })
  })

  it('reports requested files that no longer exist as failures', async () => {
    mockListWorkspaceFiles.mockResolvedValueOnce([fileRecord('file-1', 'a.pdf')])
    const res = await POST(
      makeRequest({ fileIds: ['file-1', 'file-gone'], credentialId: 'cred-1' }),
      params()
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.exported).toHaveLength(1)
    expect(body.failed).toEqual([{ fileId: 'file-gone', error: 'File not found' }])
    expect(mockUploadBufferToDrive).toHaveBeenCalledTimes(1)
  })

  it('only exports files that match the requested ids', async () => {
    await POST(makeRequest({ fileIds: ['file-1'], credentialId: 'cred-1' }), params())
    expect(mockUploadBufferToDrive).toHaveBeenCalledTimes(1)
    expect(mockUploadBufferToDrive).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.pdf', accessToken: 'access-token' })
    )
  })
})
