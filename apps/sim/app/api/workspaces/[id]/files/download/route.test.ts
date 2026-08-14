/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { createMockRequest } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDownloadItems, mockDownloadFileStream, mockCaptureServerEvent } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDownloadItems: vi.fn(),
    mockDownloadFileStream: vi.fn(),
    mockCaptureServerEvent: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspace-files/application/download-workspace-file-items', () => ({
  downloadWorkspaceFileItems: {
    operation: { id: 'files.download', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mockDownloadItems,
  },
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { GET } from '@/app/api/workspaces/[id]/files/download/route'

const WORKSPACE_ID = 'ws-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function requestFor(query: string) {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/download?${query}`
  )
}

function result(files: Array<{ id: string; name: string; folderId: string | null }>) {
  return {
    filesToZip: files.map((file) => ({
      ...file,
      key: `workspace/${WORKSPACE_ID}/${file.id}`,
      size: 5,
      storageContext: 'workspace',
    })),
    folderPaths: new Map([['folder-1', 'Reports']]),
    renderedDocuments: new Map<string, Buffer>(),
    declaredBytes: files.length * 5,
  }
}

async function zipFrom(response: Response) {
  return JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
}

describe('GET /api/workspaces/[id]/files/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockDownloadItems.mockResolvedValue(result([{ id: 'f1', name: 'clip.mp4', folderId: null }]))
    mockDownloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('plain')]))
  })

  it('streams a zip assembled from the shared download use case result', async () => {
    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="workspace-files.zip"'
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const zip = await zipFrom(response)
    expect(await zip.file('clip.mp4')?.async('string')).toBe('plain')
  })

  it('preserves rendered entries and folder paths supplied by the use case', async () => {
    const archiveResult = result([
      { id: 'f1', name: 'overview.docx', folderId: 'folder-1' },
      { id: 'f2', name: 'hero.png', folderId: null },
    ])
    archiveResult.renderedDocuments.set('f1', Buffer.from('rendered'))
    mockDownloadItems.mockResolvedValue(archiveResult)

    const zip = await zipFrom(await GET(requestFor('fileIds=f1&fileIds=f2'), context))

    expect(await zip.file('Reports/overview.docx')?.async('string')).toBe('rendered')
    expect(await zip.file('hero.png')?.async('string')).toBe('plain')
  })

  it('preserves the internal product analytics event after authorization and selection', async () => {
    await GET(requestFor('fileIds=f1'), context)

    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      { workspace_id: WORKSPACE_ID, is_bulk: true, file_count: 1 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('authenticates before parsing and dispatching the use case', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(401)
    expect(mockDownloadItems).not.toHaveBeenCalled()
  })

  it('keeps application validation errors in the legacy error envelope', async () => {
    mockDownloadItems.mockRejectedValue(new Error('should not be raw'))

    const response = await GET(requestFor('fileIds=f1'), context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
})
