/**
 * Tests for the workspace files upload route's bounded multipart read.
 *
 * @vitest-environment node
 */
import { authMockFns, permissionsMock, permissionsMockFns, posthogServerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadWorkspaceFile, mockGetSharesForResources, mockRecordAudit } = vi.hoisted(() => ({
  mockUploadWorkspaceFile: vi.fn(),
  mockGetSharesForResources: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
  FileConflictError: class FileConflictError extends Error {},
}))

vi.mock('@/lib/uploads/shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads/shared/types')>()
  return {
    ...actual,
    MAX_WORKSPACE_FORMDATA_FILE_SIZE: 1024,
  }
})

vi.mock('@/lib/public-shares/share-manager', () => ({
  getSharesForResources: mockGetSharesForResources,
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: vi.fn().mockResolvedValue('write'),
}))
vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { FILE_UPLOADED: 'file_uploaded' },
  AuditResourceType: { FILE: 'file' },
}))

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'

import { POST } from '@/app/api/workspaces/[id]/files/route'

const routeContext = { params: Promise.resolve({ id: WS }) }

function buildFormData(file: File): FormData {
  const formData = new FormData()
  formData.append('file', file)
  return formData
}

describe('workspace files upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetSharesForResources.mockResolvedValue(new Map())
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'file.txt',
      url: 'https://example.com/file.txt',
      size: 11,
      type: 'text/plain',
    })
  })

  it('rejects a declared content-length above the limit before reading the body', async () => {
    const formData = buildFormData(new File(['x'.repeat(10)], 'file.txt', { type: 'text/plain' }))
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${WS}/files`, {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: formData,
    })

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toContain('exceeds maximum size')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects a chunked body without content-length once the streamed size trips the cap', async () => {
    const bigFile = new File(['x'.repeat(2 * 1024 * 1024)], 'file.txt', { type: 'text/plain' })
    const formData = buildFormData(bigFile)
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${WS}/files`, {
      method: 'POST',
      body: formData,
    })
    expect(req.headers.get('content-length')).toBeNull()

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toContain('exceeds maximum size')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('uploads a normal, well-under-limit file successfully', async () => {
    const file = new File(['hello world'], 'file.txt', { type: 'text/plain' })
    const formData = buildFormData(file)
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${WS}/files`, {
      method: 'POST',
      headers: { 'content-length': '512' },
      body: formData,
    })

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledTimes(1)
  })
})
