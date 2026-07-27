/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockVerifyWorkspaceMembership,
  mockListWorkspaceFiles,
  mockListWorkspaceFileFolders,
  mockDownloadServableFileFromStorage,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
  listWorkspaceFileFolders: mockListWorkspaceFileFolders,
  buildWorkspaceFileFolderPathMap: (folders: Array<{ id: string; name: string }>) =>
    new Map(folders.map((folder) => [folder.id, folder.name])),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'
import { GET } from '@/app/api/workspaces/[id]/files/download/route'

const WORKSPACE_ID = 'ws-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function workspaceFile(id: string, name: string, folderId: string | null) {
  return {
    id,
    name,
    key: `workspace/${WORKSPACE_ID}/${id}`,
    path: `/serve/${id}`,
    size: 100,
    type: 'application/octet-stream',
    folderId,
  }
}

function requestFor(query: string) {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/download?${query}`
  )
}

describe('workspace files download route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue({ role: 'member' })
    mockListWorkspaceFileFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', parentId: null },
    ])
  })

  it('zips the rendered bytes for a generated doc, not its stored source', async () => {
    mockListWorkspaceFiles.mockResolvedValue([workspaceFile('f1', 'overview.docx', 'folder-1')])
    // A real .docx is a ZIP; the stored source would be plain JS text.
    const rendered = Buffer.from('PKrendered-docx')
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: rendered,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(1)

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    const entry = zip.file('Reports/overview.docx')
    expect(entry).not.toBeNull()
    expect(Buffer.from(await entry!.async('uint8array'))).toEqual(rendered)
  })

  it('returns 409 naming the documents whose artifacts are still compiling', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      workspaceFile('f1', 'ready.md', 'folder-1'),
      workspaceFile('f2', 'pending.docx', 'folder-1'),
    ])
    mockDownloadServableFileFromStorage.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'pending.docx')
        throw new DocCompileUserError('Document is still being generated')
      return { buffer: Buffer.from('ok'), contentType: 'text/markdown' }
    })

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toContain('pending.docx')
    expect(body.error).not.toContain('ready.md')
  })

  it('rejects when rendered documents exceed the download size limit', async () => {
    mockListWorkspaceFiles.mockResolvedValue([workspaceFile('f1', 'huge.docx', 'folder-1')])
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.alloc(251 * 1024 * 1024),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
  })

  it('surfaces a storage failure as a 500 rather than zipping a placeholder', async () => {
    mockListWorkspaceFiles.mockResolvedValue([workspaceFile('f1', 'a.txt', 'folder-1')])
    mockDownloadServableFileFromStorage.mockRejectedValue(new Error('storage down'))

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(500)
  })
})
