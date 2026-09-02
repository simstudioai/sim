/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'

const {
  mockAssertActiveWorkspaceAccess,
  mockDownloadServableFileFromStorage,
  mockDownloadFileFromStorage,
  mockDecompressArchiveBufferToWorkspaceFiles,
  mockEnsureWorkspaceFileFolderPath,
  mockListWorkspaceFileFolders,
  mockCreateWorkspaceFileFolder,
  mockUpdateWorkspaceFileFolder,
  mockDeleteWorkspaceFileFolder,
  mockRestoreWorkspaceFileFolder,
  mockListAllWorkspaceFiles,
  mockFetchWorkspaceFileBuffer,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockLoadActiveWorkspaceContext,
  mockLoadActiveWorkspaceFileContext,
  mockMoveWorkspaceFileItems,
  mockEditWorkspaceFileContent,
  mockResolveEffectiveWorkspacePermission,
  mockGetFileMetadataByKey,
  mockGetWorkspaceFile,
  mockVerifyFileAccess,
  mockResolveWorkspaceFileReference,
  mockUpdateWorkspaceFileContent,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockDownloadFileFromStorage: vi.fn(),
  mockDecompressArchiveBufferToWorkspaceFiles: vi.fn(),
  mockEnsureWorkspaceFileFolderPath: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockCreateWorkspaceFileFolder: vi.fn(),
  mockUpdateWorkspaceFileFolder: vi.fn(),
  mockDeleteWorkspaceFileFolder: vi.fn(),
  mockRestoreWorkspaceFileFolder: vi.fn(),
  mockListAllWorkspaceFiles: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockLoadActiveWorkspaceContext: vi.fn(),
  mockLoadActiveWorkspaceFileContext: vi.fn(),
  mockMoveWorkspaceFileItems: vi.fn(),
  mockEditWorkspaceFileContent: vi.fn(),
  mockResolveEffectiveWorkspacePermission: vi.fn(),
  mockGetFileMetadataByKey: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads/archive')>()
  return {
    ...actual,
    decompressArchiveBufferToWorkspaceFiles: (...args: unknown[]) =>
      mockDecompressArchiveBufferToWorkspaceFiles(...args),
  }
})

vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: vi.fn(() => false),
  parseBuffer: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPLOADED: 'file_uploaded', FILE_UPDATED: 'file_updated' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceFilesChanged: vi.fn(async () => undefined),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getShareForResource: vi.fn().mockResolvedValue(null),
  getSharesForResources: vi.fn().mockResolvedValue(new Map()),
  ShareValidationError: class ShareValidationError extends Error {},
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' ||
    permission === required ||
    (permission === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: (...args: unknown[]) =>
    mockResolveEffectiveWorkspacePermission(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  loadActiveWorkspaceContext: (...args: unknown[]) => mockLoadActiveWorkspaceContext(...args),
  loadActiveWorkspaceFileContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
  resolveWorkspaceFileReference: (...args: unknown[]) => mockResolveWorkspaceFileReference(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateWorkspaceFileContent(...args),
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: class FileConflictError extends Error {},
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  loadActiveWorkspaceContext: (...args: unknown[]) => mockLoadActiveWorkspaceContext(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateWorkspaceFileContent(...args),
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  ensureWorkspaceFileFolderPathOperation: {
    execute: (...args: unknown[]) => mockEnsureWorkspaceFileFolderPath(...args),
  },
  listWorkspaceFileFoldersOperation: {
    execute: (...args: unknown[]) => mockListWorkspaceFileFolders(...args),
  },
  createWorkspaceFileFolderOperation: {
    execute: (...args: unknown[]) => mockCreateWorkspaceFileFolder(...args),
  },
  updateWorkspaceFileFolderOperation: {
    execute: (...args: unknown[]) => mockUpdateWorkspaceFileFolder(...args),
  },
  deleteWorkspaceFileFolderOperation: {
    execute: (...args: unknown[]) => mockDeleteWorkspaceFileFolder(...args),
  },
  restoreWorkspaceFileFolderOperation: {
    execute: (...args: unknown[]) => mockRestoreWorkspaceFileFolder(...args),
  },
}))

vi.mock('@/lib/workspace-files/application/edit-workspace-file-content', () => ({
  editWorkspaceFileContent: {
    execute: (...args: unknown[]) => mockEditWorkspaceFileContent(...args),
  },
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: { execute: (...args: unknown[]) => mockListAllWorkspaceFiles(...args) },
}))

vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    execute: (...args: unknown[]) => mockMoveWorkspaceFileItems(...args),
  },
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE: { status: 'exact', entries: [] },
  getBoundWorkspaceFileSecretProvenance: (...args: unknown[]) =>
    mockGetBoundWorkspaceFileSecretProvenance(...args),
  mergeWorkspaceFileSecretProvenance: (
    ...provenances: Array<
      | { status: 'exact'; entries: Array<{ name: string; encryptedValue: string }> }
      | {
          status: 'unknown'
        }
    >
  ) =>
    provenances.some((provenance) => provenance.status === 'unknown')
      ? { status: 'unknown' }
      : {
          status: 'exact',
          entries: provenances.flatMap((provenance) =>
            provenance.status === 'exact' ? provenance.entries : []
          ),
        },
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: (...args: unknown[]) => mockGetFileMetadataByKey(...args),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: (...args: unknown[]) => mockDownloadFileFromStorage(...args),
  downloadServableFileFromStorage: (...args: unknown[]) =>
    mockDownloadServableFileFromStorage(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: (...args: unknown[]) => mockAssertActiveWorkspaceAccess(...args),
  getUserEntityPermissions: vi.fn(),
  isWorkspaceAccessDeniedError: vi.fn(() => false),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: (...args: unknown[]) => mockVerifyFileAccess(...args),
}))

import { fileManageBodySchema } from '@/lib/api/contracts/tools/file'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
import { FileConflictError } from '@/lib/uploads/contexts/workspace'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

async function POST(request: Request): Promise<Response> {
  const parsed = fileManageBodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request data' },
      { status: 400 }
    )
  }
  const workspaceId = parsed.data.workspaceId || 'workspace-1'
  return executeFileManageOperation(parsed.data, {
    principal: createWorkspaceFileDelegatedPrincipal({
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId,
      delegationId: 'test-file-operation',
    }),
    workspaceId,
    attributedUserId: 'user-1',
    fileAccessUserId: 'user-1',
    workflowId: 'workflow-1',
    headers: request.headers,
    requestId: 'request-1',
    signal: request.signal,
  })
}

const PRIVATE_REQUEST_HEADER = {
  'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
}
const PRIVATE_SECRET_PROVENANCE_HEADER = {
  'x-sim-private-secret-provenance': 'private-secret-provenance-bundle-v1',
}
const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

function workspaceFile(id: string, ownerUserId = 'user-1') {
  return {
    id,
    workspaceId: 'workspace-1',
    name: `${id}.txt`,
    key: `workspace/workspace-1/${id}.txt`,
    path: `/api/files/serve/${id}`,
    size: id.length,
    type: 'text/plain',
    uploadedBy: ownerUserId,
    uploadedAt: CONTENT_UPDATED_AT,
    updatedAt: CONTENT_UPDATED_AT,
    contentUpdatedAt: CONTENT_UPDATED_AT,
  }
}

function actorlessDeploymentPrincipal(workspaceId = 'workspace-1') {
  return {
    kind: 'delegated' as const,
    serviceId: 'executor' as const,
    workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:workspace-files',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution' as const,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId,
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-1',
      },
    },
  }
}

/*
 * The folder path exists in three places — the block's params, the contract, and
 * the operation — and only the two ends were tested. A rebase dropped folder
 * expansion out of the middle, and every unit test stayed green while a
 * folder-only read failed with "File is required". These cover the middle.
 */
describe('file manage folder wiring', () => {
  const FOLDER_ROW = {
    id: 'folder-reports',
    parentId: null,
    name: 'Reports',
    path: 'Reports',
    createdAt: CONTENT_UPDATED_AT,
    updatedAt: CONTENT_UPDATED_AT,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mockLoadActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGetWorkspaceFile.mockImplementation(async (_ws: string, fileId: string) =>
      workspaceFile(fileId)
    )
    mockLoadActiveWorkspaceFileContext.mockImplementation(async (fileId: string) => ({
      fileId,
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    }))
    mockListWorkspaceFileFolders.mockResolvedValue({ folders: [FOLDER_ROW] })
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('file-in-folder'), folderId: 'folder-reports' },
        { ...workspaceFile('file-at-root'), folderId: null },
      ],
    })
    mockEnsureWorkspaceFileFolderPath.mockImplementation(
      async ({ input }: { input: { pathSegments: string[] } }) => ({
        folderId: input.pathSegments.length === 0 ? null : 'folder-reports',
        createdFolderIds: [],
      })
    )
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'new-file',
      name: 'new.txt',
      key: 'workspace/workspace-1/new.txt',
      url: '/api/files/serve/new-file',
    })
    /* The manager takes (workspaceId, reference) positionally, not an object. */
    mockResolveWorkspaceFileReference.mockImplementation(
      async (_workspaceId: string, reference: string) => workspaceFile(reference)
    )
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('before'))
    mockUpdateWorkspaceFileContent.mockResolvedValue({ file: workspaceFile('file-1') })
    mockEditWorkspaceFileContent.mockResolvedValue({
      file: workspaceFile('file-in-folder'),
      lineCount: 4,
    })
  })

  /*
   * A per-user memory tree is exactly where a name collides: `self.md` exists
   * under every user's folder. These pin that the folder is what disambiguates
   * it, and that an ambiguous name is refused rather than resolved arbitrarily.
   */
  describe('editing a named file inside a folder', () => {
    const MEMORY_FOLDERS = [
      { ...FOLDER_ROW, id: 'memory', name: 'memory', path: 'memory' },
      { ...FOLDER_ROW, id: 'user-a', parentId: 'memory', name: 'user-a', path: 'memory/user-a' },
      {
        ...FOLDER_ROW,
        id: 'user-a-people',
        parentId: 'user-a',
        name: 'people',
        path: 'memory/user-a/people',
      },
      { ...FOLDER_ROW, id: 'user-b', parentId: 'memory', name: 'user-b', path: 'memory/user-b' },
    ]

    beforeEach(() => {
      mockListWorkspaceFileFolders.mockResolvedValue({ folders: MEMORY_FOLDERS })
      mockListAllWorkspaceFiles.mockResolvedValue({
        files: [
          { ...workspaceFile('a-self'), name: 'self.md', folderId: 'user-a' },
          { ...workspaceFile('a-people-self'), name: 'self.md', folderId: 'user-a-people' },
          { ...workspaceFile('b-self'), name: 'self.md', folderId: 'user-b' },
        ],
      })
    })

    it('resolves a name inside its folder rather than workspace-wide', async () => {
      const response = await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'self.md',
          folderPath: '/memory/user-a',
          includeSubfolders: false,
          oldString: 'old',
          newString: 'new',
        })
      )

      expect(response.status).toBe(200)
      expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith('workspace-1', 'a-self')
    })

    /* The refusal names the candidates so the caller can choose one. */
    /*
     * `wf_` is a legal filename prefix, so a file can be NAMED like an id. An
     * exact id inside the scope has to win, or a caller passing a real id is
     * answered with a different file that merely happens to be called that.
     */
    it('prefers an exact id over a file merely named like one', async () => {
      mockListAllWorkspaceFiles.mockResolvedValue({
        files: [
          { ...workspaceFile('a-self'), name: 'a-people-self', folderId: 'user-a' },
          { ...workspaceFile('a-people-self'), name: 'self.md', folderId: 'user-a' },
        ],
      })

      await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'a-people-self',
          folderPath: '/memory/user-a',
          oldString: 'old',
          newString: 'new',
        })
      )

      expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
        'workspace-1',
        'a-people-self'
      )
    })

    it('refuses an ambiguous name instead of editing an arbitrary file', async () => {
      const response = await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'self.md',
          folderPath: '/memory/user-a',
          oldString: 'old',
          newString: 'new',
        })
      )

      const body = await response.json()
      expect(body.success).toBe(false)
      expect(String(body.error)).toContain('a-self')
      expect(String(body.error)).toContain('a-people-self')
      expect(mockEditWorkspaceFileContent).not.toHaveBeenCalled()
    })

    it("never reaches a sibling user's file of the same name", async () => {
      await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'self.md',
          folderPath: '/memory/user-a',
          includeSubfolders: false,
          oldString: 'old',
          newString: 'new',
        })
      )

      expect(mockResolveWorkspaceFileReference).not.toHaveBeenCalledWith('workspace-1', 'b-self')
    })

    it('passes the replacement through as a string edit', async () => {
      await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'a-self',
          oldString: 'old text',
          newString: 'new text',
        })
      )

      expect(mockEditWorkspaceFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            edit: { mode: 'replace_string', oldString: 'old text', newString: 'new text' },
          }),
        })
      )
    })

    it('passes an insert through as a line edit', async () => {
      await POST(
        createMockRequest('POST', {
          operation: 'insert',
          workspaceId: 'workspace-1',
          fileName: 'a-self',
          afterLine: 3,
          content: '- new commitment',
        })
      )

      expect(mockEditWorkspaceFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            edit: { mode: 'insert_lines', afterLine: 3, content: '- new commitment' },
          }),
        })
      )
    })

    it('rejects a negative insert line at the contract', async () => {
      const response = await POST(
        createMockRequest('POST', {
          operation: 'insert',
          workspaceId: 'workspace-1',
          fileName: 'a-self',
          afterLine: -1,
          content: 'x',
        })
      )

      expect(response.status).toBe(400)
      expect(mockEditWorkspaceFileContent).not.toHaveBeenCalled()
    })

    it('rejects empty search text at the contract', async () => {
      const response = await POST(
        createMockRequest('POST', {
          operation: 'edit',
          workspaceId: 'workspace-1',
          fileName: 'a-self',
          oldString: '',
          newString: 'x',
        })
      )

      expect(response.status).toBe(400)
      expect(mockEditWorkspaceFileContent).not.toHaveBeenCalled()
    })
  })

  it('expands a folder-only read instead of rejecting it', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'read',
        workspaceId: 'workspace-1',
        folderPaths: ['/Reports'],
      })
    )

    // A folder alone is a complete selection, expanded when the workflow runs.
    expect(response.status).not.toBe(400)
    expect(mockListWorkspaceFileFolders).toHaveBeenCalled()
    expect(mockListAllWorkspaceFiles).toHaveBeenCalled()
  })

  it('refuses a folder that does not exist rather than reading nothing', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'read',
        workspaceId: 'workspace-1',
        folderPaths: ['/Nope'],
      })
    )
    const body = await response.json()

    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('Folder not found')
  })

  it('writes into the folder it was given, not the workspace root', async () => {
    await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        folderPath: '/Reports',
        content: 'hello',
      })
    )

    expect(mockEnsureWorkspaceFileFolderPath).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ pathSegments: ['Reports'] }) })
    )
  })

  it('still writes to the root when no folder is given', async () => {
    await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        content: 'hello',
      })
    )

    expect(mockEnsureWorkspaceFileFolderPath).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ pathSegments: [] }) })
    )
  })

  /*
   * The case that motivated this: two files share a name in different folders,
   * and a typed name alone resolves to the oldest match anywhere. The folder is
   * the only thing telling them apart.
   */
  it('appends to the file in the chosen folder, not a same-named file elsewhere', async () => {
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('notes-elsewhere'), name: 'notes.md', folderId: null },
        { ...workspaceFile('notes-in-reports'), name: 'notes.md', folderId: 'folder-reports' },
      ],
    })
    mockGetWorkspaceFile.mockImplementation(async (_ws: string, fileId: string) => ({
      ...workspaceFile(fileId),
      name: 'notes.md',
    }))

    await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        folderPath: '/Reports',
        content: 'more',
      })
    )

    // Resolved by the id found inside the folder, never by the bare name.
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
      'workspace-1',
      'notes-in-reports'
    )
  })

  /*
   * The first version of this fix narrowed "oldest match in the workspace" to
   * "first match in the folder" and called it done. With Include Subfolders on
   * — the default — a subtree can hold the same name many times, so it still
   * wrote to an arbitrary file, just a nearer one.
   */
  it('refuses an ambiguous name in a recursive scope instead of picking one', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue({
      folders: [
        FOLDER_ROW,
        {
          ...FOLDER_ROW,
          id: 'folder-q3',
          parentId: 'folder-reports',
          name: 'Q3',
          path: 'Reports/Q3',
        },
      ],
    })
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('notes-top'), name: 'notes.md', folderId: 'folder-reports' },
        { ...workspaceFile('notes-deep'), name: 'notes.md', folderId: 'folder-q3' },
      ],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        folderPath: '/Reports',
        content: 'more',
      })
    )
    const body = await response.json()

    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('2 files named notes.md')
    // Names the candidates, so the caller can pick one rather than guess.
    expect(String(body.error)).toContain('notes-top')
    expect(String(body.error)).toContain('notes-deep')
  })

  /*
   * `wf_` is a legal filename prefix. Treating it as "already an id" silently
   * dropped the folder scope for anyone who named a file that way.
   */
  it('scopes a file whose name begins with the id prefix', async () => {
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('real-id'), name: 'wf_notes.md', folderId: 'folder-reports' },
        { ...workspaceFile('decoy'), name: 'wf_notes.md', folderId: null },
      ],
    })

    await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'wf_notes.md',
        folderPath: '/Reports',
        content: 'more',
      })
    )

    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith('workspace-1', 'real-id')
  })

  it('accepts a canonical id inside a scope as well as a name', async () => {
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('notes-in-reports'), name: 'notes.md', folderId: 'folder-reports' },
      ],
    })

    await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'notes-in-reports',
        folderPath: '/Reports',
        content: 'more',
      })
    )

    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
      'workspace-1',
      'notes-in-reports'
    )
  })

  it('refuses rather than appending to a same-named file outside the folder', async () => {
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [{ ...workspaceFile('notes-elsewhere'), name: 'notes.md', folderId: null }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        folderPath: '/Reports',
        content: 'more',
      })
    )
    const body = await response.json()

    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('No file named notes.md in /Reports')
  })

  /*
   * A folder genuinely named `Q3/Q4` is one level, but the joined reference the
   * overwrite lookup used re-read it as two — so the existing file was never
   * found and the write landed as a duplicate beside it.
   */
  it('overwrites inside a folder whose name contains a slash', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue({
      folders: [
        {
          id: 'folder-slashy',
          parentId: null,
          name: 'Q3/Q4',
          path: 'Q3\\/Q4',
          createdAt: CONTENT_UPDATED_AT,
          updatedAt: CONTENT_UPDATED_AT,
        },
      ],
    })
    mockListAllWorkspaceFiles.mockResolvedValue({
      files: [
        { ...workspaceFile('existing-in-slashy'), name: 'notes.md', folderId: 'folder-slashy' },
      ],
    })
    mockEnsureWorkspaceFileFolderPath.mockResolvedValue({
      folderId: 'folder-slashy',
      createdFolderIds: [],
    })

    await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'notes.md',
        folderPath: '/Q3%2FQ4',
        content: 'hello',
        overwrite: true,
      })
    )

    // Found by id, not by a reference that would split the folder name in two.
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
      'workspace-1',
      'existing-in-slashy'
    )
  })

  it('lists what a folder holds, folders and files together', async () => {
    const response = await POST(
      createMockRequest('POST', { operation: 'list', workspaceId: 'workspace-1' })
    )
    const body = await response.json()

    expect(body.success).toBe(true)
    expect(body.data.entries.map((entry: { name: string }) => entry.name)).toEqual([
      'Reports',
      'file-at-root.txt',
    ])
    expect(body.data.truncated).toBe(false)
  })
})

describe('file manage operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) =>
      workspaceFile(fileId)
    )
    mockLoadActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mockLoadActiveWorkspaceFileContext.mockImplementation(async (fileId: string) => ({
      fileId,
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    }))
    mockEnsureWorkspaceFileFolderPath.mockImplementation(
      async ({ input }: { input: { pathSegments: string[] } }) => ({
        folderId: input.pathSegments.length === 0 ? null : 'folder-1',
        createdFolderIds: [],
      })
    )
    mockDownloadServableFileFromStorage.mockImplementation(async (file: { name: string }) => ({
      buffer: Buffer.from(`content:${file.name}`),
    }))
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('before'))
    mockUpdateWorkspaceFileContent.mockResolvedValue({ file: workspaceFile('file-1') })
    mockMoveWorkspaceFileItems.mockResolvedValue({ moved: 1 })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'new-file',
      name: 'new.txt',
      key: 'workspace/workspace-1/new.txt',
      url: '/api/files/serve/new-file',
    })
  })

  it('returns a scoped, deduplicated union of exact canonical file provenance', async () => {
    mockGetBoundWorkspaceFileSecretProvenance.mockImplementation(
      async (_workspaceId: string, identity: { fileId: string }) =>
        identity.fileId === 'file-1'
          ? {
              status: 'exact',
              entries: [
                { name: 'TOKEN', encryptedValue: 'encrypted-token' },
                { name: 'ALPHA', encryptedValue: 'encrypted-alpha' },
              ],
            }
          : {
              status: 'exact',
              entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
            }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: ['file-1', 'file-2'] },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { contents: ['content:file-1.txt', 'content:file-2.txt'] },
      __resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [
          { name: 'ALPHA', encryptedValue: 'encrypted-alpha' },
          { name: 'TOKEN', encryptedValue: 'encrypted-token' },
        ],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
    expect(mockGetBoundWorkspaceFileSecretProvenance).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      expect.objectContaining({ fileId: 'file-1', contentUpdatedAt: CONTENT_UPDATED_AT })
    )
    expect(mockGetBoundWorkspaceFileSecretProvenance).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      expect.objectContaining({ fileId: 'file-2', contentUpdatedAt: CONTENT_UPDATED_AT })
    )
  })

  it('pins resolved file-input provenance to the captured content revision', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue(workspaceFile('file-1'))
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [],
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'content',
          workspaceId: 'workspace-1',
          fileInput: {
            key: 'workspace/workspace-1/file-1.txt',
            name: 'file-1.txt',
            type: 'text/plain',
            size: 6,
          },
        },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockGetBoundWorkspaceFileSecretProvenance).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ fileId: 'file-1', contentUpdatedAt: CONTENT_UPDATED_AT })
    )
  })

  it('stores exact causal provenance from a different user in the actor workspace', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
                  scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('secret-value'),
      'new.txt',
      'text/plain',
      {
        exactName: false,
        folderId: null,
        folderPath: undefined,
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'TOKEN',
              encryptedValue: 'encrypted-token',
              sourceUserId: 'workflow-owner',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      }
    )
  })

  it('rejects file-write provenance from another workspace', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
                  scope: { userId: 'workflow-owner', workspaceId: 'workspace-2' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(400)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('preserves existing file-path behavior when a filename was resolved from a secret', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'Reports & Plans/2026/secret-value.txt',
          content: 'ordinary text',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [],
                  scope: { userId: 'user-1', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockEnsureWorkspaceFileFolderPath).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ kind: 'delegated', subjectUserId: 'user-1' }),
        input: { workspaceId: 'workspace-1', pathSegments: ['Reports & Plans', '2026'] },
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('ordinary text'),
      'secret-value.txt',
      'text/plain',
      {
        exactName: false,
        folderId: 'folder-1',
        folderPath: undefined,
        secretProvenance: { status: 'exact', entries: [] },
      }
    )
  })

  it('keeps a headerless file write on the legacy untracked path', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'new.txt',
        content: 'ordinary text',
      })
    )
    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('ordinary text'),
      'new.txt',
      'text/plain',
      {
        exactName: false,
        folderId: null,
        folderPath: undefined,
        secretProvenance: { status: 'exact', entries: [] },
      }
    )
  })

  it.each([
    ['Reports & Plans/2026', '/Reports%20%26%20Plans/2026'],
    ['', '/'],
  ])('moves files to the canonical folder path for %j', async (targetFolder, expectedPath) => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'move',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        targetFolder,
      })
    )

    expect(response.status).toBe(200)
    expect(mockMoveWorkspaceFileItems).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: 'workspace-1',
          fileIds: ['file-1'],
          targetFolderPath: expectedPath,
        },
      })
    )
  })

  it('returns 400 before moving when the target folder path exceeds canonical limits', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'move',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        targetFolder: Array.from(
          { length: MAX_FOLDER_PATH_SEGMENTS + 1 },
          (_, index) => `folder-${index}`
        ).join('/'),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`,
    })
    expect(mockMoveWorkspaceFileItems).not.toHaveBeenCalled()
  })

  it('persists an authenticated file write with unavailable lineage as unknown', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'new.txt',
          content: 'possibly secret',
          __privateSecretProvenance: {
            version: 1,
            complete: false,
            selections: [],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('possibly secret'),
      'new.txt',
      'text/plain',
      {
        exactName: false,
        folderId: null,
        folderPath: undefined,
        secretProvenance: { status: 'unknown' },
      }
    )
  })

  it('replaces the existing file at the target path when overwrite is on', async () => {
    const existing = workspaceFile('report')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockUpdateWorkspaceFileContent.mockResolvedValue(existing)

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        content: 'fresh',
        overwrite: true,
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'report',
      'user-1',
      Buffer.from('fresh'),
      'text/plain',
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'exact', entries: [] } },
      }
    )
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: 'report', name: 'report.txt' },
    })
  })

  it('creates the file when overwrite finds nothing at the target path', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue(null)

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        content: 'fresh',
        overwrite: true,
      })
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('fresh'),
      'report.txt',
      'text/plain',
      // Exact, so a path created by a concurrent write conflicts instead of being suffixed.
      expect.objectContaining({ exactName: true, folderId: null })
    )
  })

  it('surfaces a conflict when a concurrent write claims the overwrite path', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue(null)
    mockUploadWorkspaceFile.mockRejectedValue(new FileConflictError('report.txt'))

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        content: 'fresh',
        overwrite: true,
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })

  it('never overwrites a same-named file resolved outside the target folder', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue({
      ...workspaceFile('report'),
      folderId: 'folder-9',
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        content: 'fresh',
        overwrite: true,
      })
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).toHaveBeenCalled()
  })

  it('keeps the suffixing create path when overwrite is off', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue(workspaceFile('report'))

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        content: 'fresh',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('fresh'),
      'report.txt',
      'text/plain',
      expect.objectContaining({ exactName: false })
    )
  })

  it('overwrites an existing file with the bytes of a stored file input', async () => {
    const existing = workspaceFile('report')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockUpdateWorkspaceFileContent.mockResolvedValue(existing)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'write',
        workspaceId: 'workspace-1',
        fileName: 'report.txt',
        fileInput: {
          key: 'workspace/workspace-1/source.txt',
          name: 'source.txt',
          type: 'text/plain',
          size: 6,
        },
        overwrite: true,
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'report',
      'user-1',
      Buffer.from('content:source.txt'),
      'text/plain',
      expect.objectContaining({ expectedUpdatedAt: CONTENT_UPDATED_AT })
    )
  })

  it('downgrades provenance when overwriting a file owned by another user', async () => {
    const existing = workspaceFile('report', 'other-user')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockUpdateWorkspaceFileContent.mockResolvedValue(existing)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'write',
          workspaceId: 'workspace-1',
          fileName: 'report.txt',
          content: 'secret-value',
          overwrite: true,
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
                  scope: { userId: 'user-1', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'report',
      'user-1',
      Buffer.from('secret-value'),
      'text/plain',
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: { mode: 'replace', provenance: { status: 'unknown' } },
      }
    )
  })

  it('atomically binds append provenance to the exact predecessor version', async () => {
    const existing = workspaceFile('file-1')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [
        {
          name: 'OLD',
          encryptedValue: 'encrypted-old',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'append',
          workspaceId: 'workspace-1',
          fileName: 'file-1.txt',
          content: 'secret-value',
          __privateSecretProvenance: {
            version: 1,
            complete: true,
            selections: [
              {
                key: 'content',
                provenance: {
                  version: 1,
                  complete: true,
                  entries: [{ name: 'NEW', encryptedValue: 'encrypted-new' }],
                  scope: { userId: 'user-1', workspaceId: 'workspace-1' },
                },
              },
            ],
          },
        },
        PRIVATE_SECRET_PROVENANCE_HEADER
      )
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'file-1',
      'user-1',
      Buffer.from('beforesecret-value'),
      undefined,
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: {
          mode: 'replace',
          provenance: {
            status: 'exact',
            entries: [
              {
                name: 'OLD',
                encryptedValue: 'encrypted-old',
                sourceUserId: 'user-1',
                sourceWorkspaceId: 'workspace-1',
              },
              {
                name: 'NEW',
                encryptedValue: 'encrypted-new',
                sourceUserId: 'user-1',
                sourceWorkspaceId: 'workspace-1',
              },
            ],
          },
        },
      }
    )
  })

  it('preserves the prior classification for a legacy headerless append', async () => {
    const existing = workspaceFile('file-1')
    mockResolveWorkspaceFileReference.mockResolvedValue(existing)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'OLD', encryptedValue: 'encrypted-old' }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'append',
        workspaceId: 'workspace-1',
        fileName: 'file-1.txt',
        content: 'ordinary text',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'file-1',
      'user-1',
      Buffer.from('beforeordinary text'),
      undefined,
      {
        expectedUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenancePolicy: { mode: 'preserve' },
      }
    )
  })

  it('carries the union of source provenance into a compressed archive', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'compress',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        archiveName: 'bundle',
      })
    )

    expect(response.status).toBe(200)
    expect(Buffer.isBuffer(mockUploadWorkspaceFile.mock.calls[0]?.[2])).toBe(true)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      expect.anything(),
      'bundle.zip',
      'application/zip',
      expect.objectContaining({
        folderId: null,
        secretProvenance: {
          status: 'exact',
          entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        },
      })
    )
  })

  it('passes secret-bearing archive provenance to the decompressor', async () => {
    const archiveBuffer = Buffer.from('archive-bytes')
    mockDownloadFileFromStorage.mockResolvedValue(archiveBuffer)
    mockGetWorkspaceFile.mockResolvedValue({
      ...workspaceFile('archive'),
      name: 'archive.zip',
      type: 'application/zip',
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })
    mockDecompressArchiveBufferToWorkspaceFiles.mockResolvedValue({
      extracted: [
        {
          id: 'new-file',
          name: 'child.txt',
          key: 'workspace/workspace-1/child.txt',
          url: '/api/files/serve/new-file',
          size: 12,
          type: 'text/plain',
          context: 'workspace',
        },
      ],
      skipped: 0,
      skippedUnsafePaths: [],
    })

    const response = await POST(
      createMockRequest('POST', {
        operation: 'decompress',
        workspaceId: 'workspace-1',
        fileId: 'archive',
      })
    )

    expect(response.status).toBe(200)
    expect(mockDownloadFileFromStorage).toHaveBeenCalledTimes(1)
    expect(mockDecompressArchiveBufferToWorkspaceFiles).toHaveBeenCalledWith(
      archiveBuffer,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        principal: expect.objectContaining({ kind: 'delegated', subjectUserId: 'user-1' }),
        secretProvenance: {
          status: 'exact',
          entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        },
      })
    )
  })

  it('decompresses a canonical workspace archive for an actorless deployed execution', async () => {
    const archiveBuffer = Buffer.from('archive-bytes')
    const principal = actorlessDeploymentPrincipal()
    mockDownloadFileFromStorage.mockResolvedValue(archiveBuffer)
    mockGetWorkspaceFile.mockResolvedValue({
      ...workspaceFile('archive'),
      name: 'archive.zip',
      type: 'application/zip',
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [],
    })
    mockDecompressArchiveBufferToWorkspaceFiles.mockResolvedValue({
      extracted: [
        {
          ...workspaceFile('child'),
          url: '/api/files/serve/child',
          context: 'workspace',
        },
      ],
      skipped: 0,
      skippedUnsafePaths: [],
    })

    const response = await executeFileManageOperation(
      fileManageBodySchema.parse({
        operation: 'decompress',
        workspaceId: 'workspace-1',
        fileId: 'archive',
      }),
      {
        principal,
        workspaceId: 'workspace-1',
        attributedUserId: 'workspace-owner',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        headers: new Headers(),
        requestId: 'request-actorless',
      }
    )

    expect(response.status).toBe(200)
    expect(mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'archive', {
      throwOnError: true,
    })
    expect(mockDecompressArchiveBufferToWorkspaceFiles).toHaveBeenCalledWith(
      archiveBuffer,
      expect.objectContaining({ principal, workspaceId: 'workspace-1' })
    )
  })

  it('rejects an actorless deployment principal bound to a different workspace', async () => {
    const response = await executeFileManageOperation(
      fileManageBodySchema.parse({
        operation: 'decompress',
        workspaceId: 'workspace-1',
        fileId: 'archive',
      }),
      {
        principal: actorlessDeploymentPrincipal('workspace-2'),
        workspaceId: 'workspace-1',
        attributedUserId: 'workspace-owner',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        headers: new Headers(),
        requestId: 'request-cross-workspace',
      }
    )

    expect(response.status).toBe(403)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mockDecompressArchiveBufferToWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('omits source scope when canonical files have different owners', async () => {
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) =>
      workspaceFile(fileId, fileId === 'file-1' ? 'user-1' : 'user-2')
    )
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: ['file-1', 'file-2'] },
        PRIVATE_REQUEST_HEADER
      )
    )
    const body = await response.json()

    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    })
  })

  it('returns incomplete provenance for an input that cannot bind to a canonical file row', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue(null)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'content',
          workspaceId: 'workspace-1',
          fileInput: {
            key: 'workspace/workspace-1/unbound.txt',
            name: 'unbound.txt',
            type: 'text/plain',
            size: 7,
          },
        },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      __resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
    })
    expect(mockGetBoundWorkspaceFileSecretProvenance).not.toHaveBeenCalled()
  })

  it('keeps a normal not-found error while returning a valid private envelope', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'content', workspaceId: 'workspace-1', fileId: 'missing-file' },
        PRIVATE_REQUEST_HEADER
      )
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'File not found: "missing-file"',
      __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
    })
  })

  it('does not add private transport fields when provenance was not requested', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))

    const response = await POST(
      createMockRequest('POST', {
        operation: 'content',
        workspaceId: 'workspace-1',
        fileId: 'file-1',
      })
    )

    expect(response.headers.get('x-sim-private-tool-metadata')).toBeNull()
    const body = await response.json()
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(mockGetBoundWorkspaceFileSecretProvenance).not.toHaveBeenCalled()
  })

  it('never uses query.userId as the authorization identity', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile('file-1'))

    const response = await POST(
      createMockRequest(
        'POST',
        { operation: 'get', workspaceId: 'workspace-1', fileId: 'file-1' },
        {},
        'http://localhost:3000/api/tools/file/manage?userId=attacker'
      )
    )

    expect(response.status).toBe(200)
    expect(mockResolveEffectiveWorkspacePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      null,
      undefined,
      { forUpdate: undefined }
    )
  })
})
