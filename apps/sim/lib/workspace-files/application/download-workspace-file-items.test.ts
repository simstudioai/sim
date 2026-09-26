import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { events, mockFetchServable, mockIsDocNotReady } = vi.hoisted(() => ({
  events: [] as string[],
  mockFetchServable: vi.fn(),
  mockIsDocNotReady: vi.fn(),
}))
const {
  mockLoadWorkspaceFileOperationContext: mockLoadContext,
  mockListWorkspaceFiles: mockListFiles,
  mockListWorkspaceFileFolders: mockListFolders,
} = workspaceUploadsMockFns

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mockFetchServable,
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/doc-not-ready', () => ({
  docNotReadyMessage: (names: string[]) => `Pending: ${names.join(', ')}`,
  isDocNotReadyError: mockIsDocNotReady,
}))
vi.mock('@sim/audit', () => auditMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'

const { mockGetUserPermissionConfig } = permissionGroupsResolveMockFns
const {
  mockIsGeneratedDocumentSourceType: mockIsGenerated,
  mockIsRenderableDocumentName: mockIsRenderable,
} = fileUtilsMockFns

/** The use case passes the organization the authorized context already loaded. */
permissionGroupsResolveMockFns.mockResolveVerifiedUserAccessControlContext.mockImplementation(
  async (userId: string, workspaceId: string) => ({
    config: await mockGetUserPermissionConfig(userId, workspaceId),
  })
)
fileUtilsMockFns.mockFormatFileSize.mockImplementation((bytes: number) => `${bytes} bytes`)
fileUtilsMockFns.mockNeedsRenderedArtifact.mockImplementation(
  (contentType: string | null | undefined, fileName: string) =>
    contentType ? mockIsGenerated(contentType) : mockIsRenderable(fileName)
)

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const principal = createSessionPrincipal({ userId: 'u1', sessionId: 's1' })
const delegatedPrincipal = createDelegatedPrincipal({
  subjectUserId: 'u1',
  workspaceId: 'ws-1',
  audience: 'sim:workspace-files',
  resourceScope: { fileId: 'f1' },
})
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
    mockGetUserPermissionConfig.mockResolvedValue(null)
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

  describe('permission-group capability', () => {
    beforeEach(() => {
      mockGetUserPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableBulkFileDownload: true,
      })
      mockListFolders.mockResolvedValue([{ id: 'folder-1', parentId: null, name: 'Reports' }])
      mockListFiles.mockImplementation(async () => {
        events.push('execute')
        return [file('f1', 'clip.mp4'), file('f2', 'notes.txt', 'folder-1')]
      })
    })

    it('refuses a folder archive when the group withholds files.bulk_download', async () => {
      await expect(
        downloadWorkspaceFileItems.execute({
          principal,
          input: { workspaceId: 'ws-1', fileIds: [], folderIds: ['folder-1'] },
        })
      ).rejects.toMatchObject({ capability: 'files.bulk_download' })

      expect(events).not.toContain('execute')
    })

    /**
     * A run carries the role of whoever triggered it but not their capabilities
     * — `authorizeWorkspaceOperation` exempts a subject-bearing executor — and
     * an assertion that read the subject straight off the principal re-applied
     * here exactly what the funnel exempts.
     */
    it('does not apply the capability to a delegated executor carrying a subject', async () => {
      await expect(
        downloadWorkspaceFileItems.execute({
          principal: {
            ...delegatedPrincipal,
            serviceId: 'executor' as const,
            resourceScope: {},
          },
          input: { workspaceId: 'ws-1', fileIds: [], folderIds: ['folder-1'] },
        })
      ).resolves.toMatchObject({ filesToZip: [expect.objectContaining({ id: 'f2' })] })
    })

    it('still allows downloading a single named file, which the key does not withhold', async () => {
      await expect(
        downloadWorkspaceFileItems.execute({
          principal,
          input: { workspaceId: 'ws-1', fileIds: ['f1'], folderIds: [] },
        })
      ).resolves.toMatchObject({ filesToZip: [expect.objectContaining({ id: 'f1' })] })
    })
  })
})
