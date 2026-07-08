/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetPerms, mockResolveImage, mockDownloadFile } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetPerms: vi.fn(),
  mockResolveImage: vi.fn(),
  mockDownloadFile: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getUserEntityPermissions: mockGetPerms }))
vi.mock('@/lib/uploads/server/inline-image', () => ({
  resolveWorkspaceInlineImage: mockResolveImage,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mockDownloadFile }))

import { GET } from '@/app/api/workspaces/[id]/files/inline/route'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const params = { params: Promise.resolve({ id: 'ws-1' }) }
const req = (q: string) => new NextRequest(`http://localhost/api/workspaces/ws-1/files/inline?${q}`)

describe('GET /api/workspaces/[id]/files/inline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockGetPerms.mockResolvedValue('read')
    mockResolveImage.mockResolvedValue({
      key: 'workspace/ws-1/x-photo.png',
      contentType: 'image/png',
      filename: 'photo.png',
    })
    mockDownloadFile.mockResolvedValue(PNG)
  })

  it('serves a workspace-scoped image by fileId', async () => {
    const res = await GET(req('fileId=wf_abc'), params)
    expect(res.status).toBe(200)
    expect(mockResolveImage).toHaveBeenCalledWith('ws-1', { fileId: 'wf_abc' })
  })

  it('serves a workspace-scoped image by key', async () => {
    const res = await GET(req(`key=${encodeURIComponent('workspace/ws-1/x-photo.png')}`), params)
    expect(res.status).toBe(200)
  })

  it('404s when the reference does not resolve in the workspace (cross-workspace)', async () => {
    mockResolveImage.mockResolvedValue(null)
    const res = await GET(req('fileId=wf_other'), params)
    expect(res.status).toBe(404)
  })

  it('404s without workspace membership, before resolving the file', async () => {
    mockGetPerms.mockResolvedValue(null)
    const res = await GET(req('fileId=wf_abc'), params)
    expect(res.status).toBe(404)
    expect(mockResolveImage).not.toHaveBeenCalled()
  })

  it('401s without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(req('fileId=wf_abc'), params)
    expect(res.status).toBe(401)
  })

  it('400s when neither key nor fileId is provided', async () => {
    const res = await GET(req(''), params)
    expect(res.status).toBe(400)
  })
})
