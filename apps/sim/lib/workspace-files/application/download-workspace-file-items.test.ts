/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  events,
  mockLoadContext,
  mockResolvePermission,
  mockListFiles,
  mockListFolders,
  mockFetchServable,
  mockRecordAudit,
  mockIsGenerated,
  mockIsRenderable,
  mockIsDocNotReady,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockLoadContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockListFiles: vi.fn(),
  mockListFolders: vi.fn(),
  mockFetchServable: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockIsGenerated: vi.fn(),
  mockIsRenderable: vi.fn(),
  mockIsDocNotReady: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  buildWorkspaceFileFolderPathMap: (folders: Array<{ id: string; path?: string; name: string }>) =>
    new Map(folders.map((folder) => [folder.id, folder.path ?? folder.name])),
  listWorkspaceFileFolders: mockListFolders,
  listWorkspaceFiles: mockListFiles,
  loadWorkspaceFileOperationContext: mockLoadContext,
}))
vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mockFetchServable,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  formatFileSize: (bytes: number) => `${bytes} bytes`,
  isGeneratedDocumentSourceType: mockIsGenerated,
  isRenderableDocumentName: mockIsRenderable,
  MAX_RENDERED_DOCUMENT_BYTES: 50 * 1024 * 1024,
  needsRenderedArtifact: (contentType: string | null | undefined, fileName: string) =>
    contentType ? mockIsGenerated(contentType) : mockIsRenderable(fileName),
}))
vi.mock('@/lib/uploads/utils/doc-not-ready', () => ({
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
const delegatedPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'u1',
  workspaceId: 'ws-1',
  delegationId: 'delegation-1',
  audience: 'sim:workspace-files',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  resourceScope: { fileId: 'f1' },
}
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
    events.length = 0
    mockLoadContext.mockImplementation(async () => {
      events.push('resolve')
      return workspace
    })
    mockResolvePermission.mockImplementation(async () => {
      events.push('authorize')
      return 'read'
    })
    mockListFiles.mockImplementation(async () => {
      events.push('execute')
      return [file('f1', 'clip.mp4')]
    })
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

    expect(events).toEqual(['resolve', 'authorize', 'execute'])
    expect(result.filesToZip).toHaveLength(1)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u1', workspaceId: 'ws-1' })
    )
  })

  it('allows a file-scoped delegated principal to download its one explicit file', async () => {
    const result = await downloadWorkspaceFileItems.execute({
      principal: delegatedPrincipal,
      input: { workspaceId: 'ws-1', fileIds: ['f1'], folderIds: [] },
    })

    expect(result.filesToZip.map((item) => item.id)).toEqual(['f1'])
    expect(mockResolvePermission).toHaveBeenCalledOnce()
  })

  it.each([
    { label: 'multiple files', fileIds: ['f1', 'f2'], folderIds: [] },
    { label: 'a folder', fileIds: [], folderIds: ['folder-1'] },
    { label: 'a file and folder', fileIds: ['f1'], folderIds: ['folder-1'] },
    { label: 'a folder path', fileIds: [], folderIds: [], folderPaths: ['/Reports'] },
    {
      label: 'a file and folder path',
      fileIds: ['f1'],
      folderIds: [],
      folderPaths: ['/Reports'],
    },
  ])('denies a file-scoped delegated principal selecting $label before listing', async (input) => {
    await expect(
      downloadWorkspaceFileItems.execute({
        principal: delegatedPrincipal,
        input: { workspaceId: 'ws-1', ...input },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockListFiles).not.toHaveBeenCalled()
    expect(mockListFolders).not.toHaveBeenCalled()
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
    expect(mockFetchServable).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
      principal,
      { maxBytes: 50 * 1024 * 1024 }
    )
  })

  /**
   * v2 addresses folders by path. Resolution reuses the folder set the
   * selection already loads, so it costs no extra query.
   */
  it('resolves folder paths to the same expansion as folder ids', async () => {
    mockListFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', path: 'Reports', parentId: null },
      { id: 'folder-2', name: 'Drafts', path: 'Reports/Drafts', parentId: 'folder-1' },
    ])
    mockListFiles.mockResolvedValue([file('f1', 'report.txt', 'folder-2')])

    const result = await downloadWorkspaceFileItems.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: [], folderIds: [], folderPaths: ['/Reports'] },
    })

    expect(result.filesToZip.map((item) => item.id)).toEqual(['f1'])
    expect(mockListFolders).toHaveBeenCalledOnce()
  })

  it('resolves a nested folder path without matching a same-named sibling', async () => {
    mockListFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', path: 'Reports', parentId: null },
      { id: 'folder-2', name: 'Drafts', path: 'Reports/Drafts', parentId: 'folder-1' },
      { id: 'folder-3', name: 'Drafts', path: 'Drafts', parentId: null },
    ])
    mockListFiles.mockResolvedValue([
      file('f1', 'nested.txt', 'folder-2'),
      file('f2', 'root.txt', 'folder-3'),
    ])

    const result = await downloadWorkspaceFileItems.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: [], folderIds: [], folderPaths: ['/Reports/Drafts'] },
    })

    expect(result.filesToZip.map((item) => item.id)).toEqual(['f1'])
  })

  /**
   * A misspelled folder must not silently yield a zip of whatever else the
   * request happened to select.
   */
  it('rejects a folder path that matches nothing rather than ignoring it', async () => {
    mockListFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Reports', path: 'Reports', parentId: null },
    ])
    mockListFiles.mockResolvedValue([file('f1', 'clip.mp4')])

    await expect(
      downloadWorkspaceFileItems.execute({
        principal,
        input: { workspaceId: 'ws-1', fileIds: ['f1'], folderIds: [], folderPaths: ['/Nope'] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('returns typed validation and conflict failures without recording audit', async () => {
    await expect(
      downloadWorkspaceFileItems.execute({
        principal,
        input: { workspaceId: 'ws-1', fileIds: [], folderIds: [] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(events).toEqual(['resolve', 'authorize'])

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

  it('ignores stale selected IDs when another selected file still resolves', async () => {
    const result = await downloadWorkspaceFileItems.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: ['f1', 'stale-file'], folderIds: [] },
    })

    expect(result.filesToZip.map((item) => item.id)).toEqual(['f1'])
  })
})
