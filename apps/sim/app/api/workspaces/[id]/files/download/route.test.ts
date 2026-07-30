/**
 * @vitest-environment node
 */
import { Readable } from 'stream'
import { createMockRequest } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockVerifyWorkspaceMembership,
  mockListWorkspaceFiles,
  mockListWorkspaceFileFolders,
  mockFetchServableWorkspaceFileBuffer,
  mockDownloadFileStream,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockFetchServableWorkspaceFileBuffer: vi.fn(),
  mockDownloadFileStream: vi.fn(),
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

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
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
const MB = 1024 * 1024

function workspaceFile(id: string, name: string, folderId: string | null = 'folder-1') {
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

/** A file whose stored bytes are a generator source, so it must be resolved. */
function generatedDocument(id: string, name: string, folderId: string | null = 'folder-1') {
  return { ...workspaceFile(id, name, folderId), type: 'text/x-docxjs' }
}

function requestFor(query: string) {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/download?${query}`
  )
}

async function zipFrom(response: Response) {
  return JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
}

describe('workspace files download route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue({ role: 'member' })
    mockListWorkspaceFileFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', parentId: null },
    ])
    mockDownloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('plain')]))
  })

  it('zips the rendered bytes for a generated doc, not its stored source', async () => {
    mockListWorkspaceFiles.mockResolvedValue([generatedDocument('f1', 'overview.docx')])
    // A real .docx is a ZIP; the stored source would be plain JS text.
    const rendered = Buffer.from('PKrendered-docx')
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: rendered,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    const entry = (await zipFrom(response)).file('Reports/overview.docx')
    expect(entry).not.toBeNull()
    expect(Buffer.from(await entry!.async('uint8array'))).toEqual(rendered)
  })

  it('streams ordinary files instead of materializing them', async () => {
    mockListWorkspaceFiles.mockResolvedValue([workspaceFile('f1', 'clip.mp4')])

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    // Nothing has been read yet: the entry opens its storage read only once the
    // consumer pulls the archive, which is what keeps peak memory to one entry.
    expect(mockDownloadFileStream).not.toHaveBeenCalled()

    const zip = await zipFrom(response)

    expect(mockDownloadFileStream).toHaveBeenCalledTimes(1)
    // Never routed through the buffering document reader.
    expect(mockFetchServableWorkspaceFileBuffer).not.toHaveBeenCalled()

    const entry = zip.file('Reports/clip.mp4')
    expect(entry).not.toBeNull()
    expect(await entry!.async('string')).toBe('plain')
  })

  it('preserves nested folder paths across both entry kinds', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', parentId: null },
      { id: 'folder-2', name: 'visuals', parentId: 'folder-1' },
    ])
    mockListWorkspaceFiles.mockResolvedValue([
      generatedDocument('f1', 'summary.docx', 'folder-1'),
      workspaceFile('f2', 'hero.png', 'folder-2'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('PKdoc'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const zip = await zipFrom(await GET(requestFor('fileIds=f1&fileIds=f2'), context))

    expect(zip.file('Reports/summary.docx')).not.toBeNull()
    expect(zip.file('visuals/hero.png')).not.toBeNull()
  })

  it('returns 409 naming the documents whose artifacts are still compiling', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      generatedDocument('f1', 'ready.docx'),
      generatedDocument('f2', 'pending.docx'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'pending.docx')
        throw new DocCompileUserError('Document is still being generated')
      return { buffer: Buffer.from('PKok'), contentType: 'application/octet-stream' }
    })

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toContain('pending.docx')
    expect(body.error).not.toContain('ready.docx')
  })

  it('rejects with 400, not 500, when a document blows its own allowance', async () => {
    mockListWorkspaceFiles.mockResolvedValue([generatedDocument('f1', 'huge.docx')])
    mockFetchServableWorkspaceFileBuffer.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
    )

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('huge.docx')
    expect(body.error).not.toContain('Selected files total')
  })

  it('counts streamed files against the same budget as rendered documents', async () => {
    // 200 MB of ordinary files leaves 50 MB of the 250 MB budget for documents.
    mockListWorkspaceFiles.mockResolvedValue([
      { ...workspaceFile('f1', 'clip.mp4'), size: 200 * MB },
      generatedDocument('f2', 'report.docx'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('PKdoc'),
      contentType: 'application/octet-stream',
    })

    await zipFrom(await GET(requestFor('fileIds=f1&fileIds=f2'), context))

    // Without reserving the streamed bytes the document would get the full 50 MB
    // ceiling, letting the archive ship 250 MB of documents on top of 200 MB of video.
    expect(mockFetchServableWorkspaceFileBuffer.mock.calls[0][1].maxBytes).toBe(50 * MB)
  })

  it('rejects when streamed files leave no budget for a document', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      { ...workspaceFile('f1', 'clip.mp4'), size: 249 * MB },
      generatedDocument('f2', 'report.docx'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
    )

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('once documents are rendered')
    // No byte count: the rendered total is not knowable, so quoting one would mislead.
    expect(body.error).not.toContain('Selected files total')
  })

  it('blames the shared budget once earlier documents have consumed it', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      generatedDocument('f1', 'first.docx'),
      generatedDocument('f2', 'second.docx'),
    ])
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      // The first document eats the whole budget, so the second's cap is the remainder.
      if (file.name === 'first.docx') {
        return { buffer: Buffer.alloc(240 * MB), contentType: 'application/octet-stream' }
      }
      throw new PayloadSizeLimitError({ label: 'servable file download', maxBytes: 1 })
    })

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('once documents are rendered')
    expect(body.error).not.toContain('second.docx')
  })

  it.each([
    ['text/x-docxjs', 'report.docx'],
    ['text/x-pptxgenjs', 'deck.pptx'],
    ['text/x-pdflibjs', 'isolated.pdf'],
    ['text/x-python-pdf', 'sandboxed.pdf'],
    ['text/x-python-xlsx', 'sheet.xlsx'],
  ])('resolves %s rather than streaming its source', async (type, name) => {
    // Both PDF generators must be covered: the isolated-vm path stores pdf-lib JS and
    // the E2B path stores Python, and either one streamed raw is the corruption bug.
    mockListWorkspaceFiles.mockResolvedValue([{ ...workspaceFile('f1', name), type }])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('PKrendered'),
      contentType: 'application/octet-stream',
    })

    await zipFrom(await GET(requestFor('fileIds=f1'), context))

    expect(mockFetchServableWorkspaceFileBuffer).toHaveBeenCalledTimes(1)
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('streams an uploaded office file rather than resolving it', async () => {
    // A real upload serves exactly its stored bytes, so it must not take the buffered
    // path — otherwise a selection of large decks is held in memory for nothing.
    const upload = {
      ...workspaceFile('f1', 'deck.pptx'),
      size: 80 * MB,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    mockListWorkspaceFiles.mockResolvedValue([upload])

    const response = await GET(requestFor('fileIds=f1'), context)
    await zipFrom(response)

    expect(response.status).toBe(200)
    expect(mockFetchServableWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockDownloadFileStream).toHaveBeenCalledTimes(1)
  })

  it('caps a generated document at the render headroom', async () => {
    mockListWorkspaceFiles.mockResolvedValue([generatedDocument('f1', 'report.docx')])
    mockFetchServableWorkspaceFileBuffer.mockResolvedValue({
      buffer: Buffer.from('PKdoc'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await zipFrom(await GET(requestFor('fileIds=f1'), context))

    expect(mockFetchServableWorkspaceFileBuffer.mock.calls[0][1].maxBytes).toBe(50 * MB)
  })

  it('surfaces a storage failure as a 500 even when another document is pending', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      generatedDocument('f1', 'pending.docx'),
      generatedDocument('f2', 'broken.docx'),
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

  it('stops resolving documents once one hard-fails', async () => {
    const files = Array.from({ length: 20 }, (_, index) =>
      generatedDocument(`f${index}`, `doc${index}.docx`)
    )
    mockListWorkspaceFiles.mockResolvedValue(files)
    mockFetchServableWorkspaceFileBuffer.mockImplementation(async (file: { name: string }) => {
      if (file.name === 'doc0.docx') throw new Error('storage down')
      return { buffer: Buffer.from('PKok'), contentType: 'application/octet-stream' }
    })

    const response = await GET(
      requestFor(files.map((file) => `fileIds=${file.id}`).join('&')),
      context
    )

    expect(response.status).toBe(500)
    expect(mockFetchServableWorkspaceFileBuffer.mock.calls.length).toBeLessThan(files.length)
  })

  it('rejects a selection whose declared sizes already exceed the limit', async () => {
    mockListWorkspaceFiles.mockResolvedValue([
      { ...workspaceFile('f1', 'a.mp4'), size: 200 * MB },
      { ...workspaceFile('f2', 'b.mp4'), size: 200 * MB },
    ])

    const response = await GET(requestFor('fileIds=f1&fileIds=f2'), context)

    expect(response.status).toBe(400)
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })
})
