/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockVerifyWorkspaceMembership,
  mockListWorkspaceFiles,
  mockListWorkspaceFileFolders,
  mockFetchServableWorkspaceFileBuffer,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockFetchServableWorkspaceFileBuffer: vi.fn(),
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
  fetchServableWorkspaceFileBuffer: mockFetchServableWorkspaceFileBuffer,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
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
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: rendered,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    expect(mockFetchServableWorkspaceFileBuffer).toHaveBeenCalledTimes(1)

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
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
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

  it('rejects with 400, not 500, when a rendered document blows the byte budget', async () => {
    mockListWorkspaceFiles.mockResolvedValue([workspaceFile('f1', 'huge.docx', 'folder-1')])
    mockFetchServableWorkspaceFileBuffer.mockRejectedValue(
      new PayloadSizeLimitError('servable file download exceeds limit')
    )

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(400)
    // Names the offending entry rather than blaming the whole selection.
    const body = await response.json()
    expect(body.error).toContain('huge.docx')
    expect(body.error).not.toContain('Selected files total')
  })

  it('lets an uploaded office file larger than the render headroom through', async () => {
    const big = { ...workspaceFile('f1', 'deck.pptx', 'folder-1'), size: 80 * 1024 * 1024 }
    mockListWorkspaceFiles.mockResolvedValue([big])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('ok'),
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    // Capped at the declared size, not the smaller render headroom.
    expect(mockFetchServableWorkspaceFileBuffer.mock.calls[0][1].maxBytes).toBe(80 * 1024 * 1024)
  })

  it('caps rendered documents per entry so concurrent reads cannot each claim the budget', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      workspaceFile('f1', 'report.docx', 'folder-1'),
      workspaceFile('f2', 'clip.mp4', 'folder-1'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('ok'),
      contentType: 'application/octet-stream',
    })

    await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    const maxBytesFor = (name: string) =>
      mockFetchServableWorkspaceFileBuffer.mock.calls.find(
        (call: [{ name: string }, { maxBytes: number }]) => call[0].name === name
      )?.[1].maxBytes

    // Only the source-backed document can render larger than it declares.
    expect(maxBytesFor('report.docx')).toBe(50 * 1024 * 1024)
    expect(maxBytesFor('clip.mp4')).toBe(250 * 1024 * 1024)
  })

  it('reports an oversized selection as 400 even when the abort cancels other reads', async () => {
    const files = Array.from({ length: 40 }, (_, index) =>
      workspaceFile(`f${index}`, `doc${index}.docx`, 'folder-1')
    )
    mockListWorkspaceFiles.mockResolvedValue(files)
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'doc0.docx')
        throw new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
      // Everything else fails the way a cancelled read would.
      throw new DOMException('The operation was aborted', 'AbortError')
    })

    const response = await GET(
      requestFor(files.map((file) => `fileIds=${file.id}`).join('&')),
      context
    )

    // Cancellation noise must not turn the size rejection into a generic 500.
    expect(response.status).toBe(400)
  })

  it('keeps the size rejection when a hard failure aborted the read first', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      workspaceFile('f1', 'broken.txt', 'folder-1'),
      workspaceFile('f2', 'huge.docx', 'folder-1'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'broken.txt') throw new Error('storage down')
      // Lands after the hard failure has already aborted the shared controller.
      await sleep(1)
      throw new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
    })

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    // "Select fewer files" is actionable; a generic 500 is not.
    expect(response.status).toBe(400)
  })

  it('stops issuing reads once one hard-fails instead of draining the selection', async () => {
    const files = Array.from({ length: 60 }, (_, index) =>
      workspaceFile(`f${index}`, `doc${index}.txt`, 'folder-1')
    )
    mockListWorkspaceFiles.mockResolvedValue(files)
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'doc0.txt') throw new Error('storage down')
      return { buffer: Buffer.from('ok'), contentType: 'text/plain' }
    })

    const response = await GET(
      requestFor(files.map((file) => `fileIds=${file.id}`).join('&')),
      context
    )

    expect(response.status).toBe(500)
    // Reads already in flight finish, but the queued remainder is never started.
    expect(mockFetchServableWorkspaceFileBuffer.mock.calls.length).toBeLessThan(files.length)
  })

  it('surfaces a storage failure as a 500 even when another document is pending', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      workspaceFile('f1', 'pending.docx', 'folder-1'),
      workspaceFile('f2', 'broken.txt', 'folder-1'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'pending.docx')
        throw new DocCompileUserError('Document is still being generated')
      throw new Error('storage down')
    })

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    // A 409 would tell the client to retry something that can never succeed.
    expect(response.status).toBe(500)
  })
})
