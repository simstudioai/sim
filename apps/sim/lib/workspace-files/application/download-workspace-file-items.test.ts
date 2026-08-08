/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorize,
  mockListFiles,
  mockListFolders,
  mockFetchServable,
  mockRecordAudit,
  mockIsGenerated,
  mockIsRenderable,
  mockIsDocNotReady,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockListFiles: vi.fn(),
  mockListFolders: vi.fn(),
  mockFetchServable: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockIsGenerated: vi.fn(),
  mockIsRenderable: vi.fn(),
  mockIsDocNotReady: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: mockAuthorize,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  buildWorkspaceFileFolderPathMap: (folders: Array<{ id: string; path?: string; name: string }>) =>
    new Map(folders.map((folder) => [folder.id, folder.path ?? folder.name])),
  fetchServableWorkspaceFileBuffer: mockFetchServable,
  listWorkspaceFileFolders: mockListFolders,
  listWorkspaceFiles: mockListFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  formatFileSize: (bytes: number) => `${bytes} bytes`,
  isGeneratedDocumentSourceType: mockIsGenerated,
  isRenderableDocumentName: mockIsRenderable,
  MAX_RENDERED_DOCUMENT_BYTES: 50 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyMessage: (names: string[]) => `Pending: ${names.join(', ')}`,
  isDocNotReadyError: mockIsDocNotReady,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: mockRecordAudit,
}))

import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'

const principal = { kind: 'session' as const, userId: 'u1', sessionId: 's1' }
const workspace = {
  workspaceId: 'ws-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

function file(id: string, name: string, folderId: string | null = null, size = 10) {
  return { id, name, folderId, size, type: 'application/octet-stream', key: `key-${id}` }
}

describe('downloadWorkspaceFileItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorize.mockResolvedValue({
      context: workspace,
      attribution: {
        attributedUserId: 'u1',
        actor: { kind: 'session', userId: 'u1' },
      },
    })
    mockListFiles.mockResolvedValue([file('f1', 'clip.mp4')])
    mockListFolders.mockResolvedValue([])
    mockIsGenerated.mockReturnValue(false)
    mockIsRenderable.mockReturnValue(false)
    mockIsDocNotReady.mockReturnValue(false)
  })

  it('authorizes the workspace once and returns the bounded selection', async () => {
    const result = await downloadWorkspaceFileItems.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: ['f1'], folderIds: [] },
    })

    expect(mockAuthorize).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ id: 'files.download' }),
      'ws-1'
    )
    expect(result.filesToZip).toHaveLength(1)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u1', workspaceId: 'ws-1' })
    )
  })

  it('expands selected folders and renders generated documents before returning', async () => {
    mockListFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', path: 'Reports', parentId: null },
      { id: 'folder-2', name: 'Drafts', path: 'Reports/Drafts', parentId: 'folder-1' },
    ])
    mockListFiles.mockResolvedValue([file('f1', 'report.docx', 'folder-2')])
    mockIsGenerated.mockReturnValue(true)
    mockFetchServable.mockResolvedValue({ buffer: Buffer.from('rendered') })

    const result = await downloadWorkspaceFileItems.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: [], folderIds: ['folder-1'] },
    })

    expect(result.filesToZip[0].id).toBe('f1')
    expect(result.renderedDocuments.get('f1')).toEqual(Buffer.from('rendered'))
    expect(mockFetchServable).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), {
      maxBytes: 50 * 1024 * 1024,
    })
  })

  it('returns typed validation and conflict failures without recording audit', async () => {
    await expect(
      downloadWorkspaceFileItems.execute({
        principal,
        input: { workspaceId: 'ws-1', fileIds: [], folderIds: [] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockAuthorize).not.toHaveBeenCalled()

    mockListFiles.mockResolvedValue([file('f1', 'pending.docx')])
    mockIsGenerated.mockReturnValue(true)
    mockIsDocNotReady.mockReturnValue(true)
    mockFetchServable.mockRejectedValue(new Error('pending'))
    await expect(
      downloadWorkspaceFileItems.execute({
        principal,
        input: { workspaceId: 'ws-1', fileIds: ['f1'], folderIds: [] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('rejects unknown selected IDs rather than exposing another workspace selection', async () => {
    mockListFiles.mockResolvedValue([])
    await expect(
      downloadWorkspaceFileItems.execute({
        principal,
        input: { workspaceId: 'ws-1', fileIds: ['other-workspace-file'], folderIds: [] },
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'not_found' }))
  })
})
