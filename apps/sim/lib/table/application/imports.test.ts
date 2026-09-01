/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  abortUpload: vi.fn(),
  assertUploadBinding: vi.fn(),
  cancelResource: vi.fn(),
  createParts: vi.fn(),
  createResource: vi.fn(),
  completeUpload: vi.fn(),
  findResource: vi.fn(),
  getResource: vi.fn(),
  getUpload: vi.fn(),
  getWorkspaceFile: vi.fn(),
  resolvePermission: vi.fn(),
  resolveTableContext: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  startUploadedImport: vi.fn(),
  tableImportBodyFromUpload: vi.fn(),
  resourceFromUpload: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/folders/locks', () => ({ withFolderTreeLock: vi.fn() }))
vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: vi.fn(),
  resolveFolderPathFromIndex: vi.fn(),
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveTableContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))

vi.mock('@/lib/table/orchestration/import-resource', () => ({
  abortAuthorizedTableImportUpload: mocks.abortUpload,
  cancelTableImportResource: mocks.cancelResource,
  createAuthorizedTableImportResource: mocks.createResource,
  findTableImportResource: mocks.findResource,
  getPrincipalTableImportUpload: mocks.getUpload,
  getTableImportResource: mocks.getResource,
  startUploadedTableImport: mocks.startUploadedImport,
  tableImportBodyFromUpload: mocks.tableImportBodyFromUpload,
  tableImportResourceFromUpload: mocks.resourceFromUpload,
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  requestOrigin: () => 'http://localhost:3000',
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  assertUploadSessionAuthBinding: mocks.assertUploadBinding,
  completeUploadSession: mocks.completeUpload,
  createUploadPartUrls: mocks.createParts,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getWorkspaceFile,
}))

import {
  cancelTableImportUseCase,
  completeTableImportUseCase,
  createTableImportPartsUseCase,
  createTableImportUseCase,
  readTableImportUseCase,
} from '@/lib/table/application/imports'

const createdAt = new Date('2026-08-01T00:00:00.000Z')
const record = {
  id: 'import-1',
  workspaceId: 'workspace-1',
  userId: 'uploader-1',
  source: { type: 'upload' as const, name: 'people.csv', contentType: 'text/csv', size: 128 },
  target: { type: 'new' as const, name: 'People' },
  options: {},
  tableId: null,
  status: 'uploading' as const,
  rowsProcessed: 0,
  error: null,
  createdAt,
  updatedAt: createdAt,
  completedAt: null,
}
const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const reader = { kind: 'session' as const, userId: 'reader-2', sessionId: 'session-2' }
const workspaceKey = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'workspace-key-1',
}
const executor = createTestRuntimePrincipal({
  principal: {
    kind: 'session',
    userId: 'executor-user-1',
    sessionId: 'session-1',
  },
})
const upload = {
  id: 'import-1',
  workspaceId: 'workspace-1',
  userId: 'uploader-1',
  fileName: 'people.csv',
}
const workspaceFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'people.csv',
  key: 'workspace/workspace-1/people.csv',
}

describe('table import application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.getResource.mockResolvedValue(record)
    mocks.cancelResource.mockResolvedValue({ ...record, status: 'canceled' })
    mocks.getUpload.mockResolvedValue(upload)
    mocks.tableImportBodyFromUpload.mockReturnValue({
      workspaceId: 'workspace-1',
      source: record.source,
      target: record.target,
    })
    mocks.createParts.mockResolvedValue([{ partNumber: 1, url: 'https://storage/part-1' }])
    mocks.abortUpload.mockResolvedValue({ ...record, status: 'canceled' })
    mocks.findResource.mockResolvedValue(null)
    mocks.completeUpload.mockImplementation(
      async ({
        session,
        finalize,
      }: {
        session: unknown
        finalize: (value: unknown) => unknown
      }) => {
        await finalize(session)
        return { session }
      }
    )
    mocks.startUploadedImport.mockResolvedValue({ ...record, status: 'ready' })
    mocks.createResource.mockResolvedValue({ record, upload: null })
    mocks.getWorkspaceFile.mockResolvedValue(workspaceFile)
    mocks.resourceFromUpload.mockReturnValue(record)
  })

  it('creates an import through the domain resource boundary without presenting a v2 DTO', async () => {
    const request = new Request('http://localhost:3000/api/table/imports', { method: 'POST' })

    await expect(
      createTableImportUseCase.execute({
        principal: reader,
        input: {
          body: {
            workspaceId: 'workspace-1',
            source: record.source,
            target: record.target,
          },
        },
        request,
      })
    ).resolves.toEqual({ import: { record, upload: null } })

    expect(mocks.createResource).toHaveBeenCalledWith({
      body: {
        workspaceId: 'workspace-1',
        source: record.source,
        target: record.target,
      },
      userId: 'reader-2',
      principal: reader,
      localOrigin: 'http://localhost:3000',
      resolvedFolderId: undefined,
      workspaceFile: undefined,
    })
    expect(record.createdAt).toBe(createdAt)
  })

  it('creates an upload import for an unscoped current-workflow executor principal', async () => {
    const request = new Request('http://localhost:3000/api/table/imports', { method: 'POST' })

    await createTableImportUseCase.execute({
      principal: executor,
      input: {
        body: {
          workspaceId: 'workspace-1',
          source: record.source,
          target: record.target,
        },
      },
      request,
    })

    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'executor-user-1',
      'workspace-1',
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'executor-user-1',
        principal: executor,
      })
    )
  })

  it('reads a durable import by workspace role rather than uploader identity', async () => {
    await expect(
      readTableImportUseCase.execute({
        principal: reader,
        input: { importId: 'import-1', workspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ import: record })

    expect(mocks.getResource).toHaveBeenCalledWith({
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'reader-2',
      'workspace-1',
      null,
      undefined,
      { forUpdate: undefined }
    )
  })

  /**
   * The 201 that creates an upload-backed import reports `status: "uploading"`
   * against an id that has no durable job row yet. Reading that id back is only
   * possible through the upload session, so the token has to be honored here the
   * same way `DELETE` honors it — otherwise the whole upload phase 404s.
   */
  it('reads an upload-phase import through its upload token', async () => {
    await expect(
      readTableImportUseCase.execute({
        principal: workspaceKey,
        input: { importId: 'import-1', workspaceId: 'workspace-1', uploadToken: 'signed-token' },
      })
    ).resolves.toEqual({ import: record })

    expect(mocks.getUpload).toHaveBeenCalledWith({
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: workspaceKey,
      uploadToken: 'signed-token',
    })
    expect(mocks.getResource).not.toHaveBeenCalled()
    expect(mocks.resourceFromUpload).toHaveBeenCalledWith(upload)
  })

  it('prefers the durable job once the upload has started one', async () => {
    const running = { ...record, status: 'running' as const }
    mocks.findResource.mockResolvedValue(running)

    await expect(
      readTableImportUseCase.execute({
        principal: workspaceKey,
        input: { importId: 'import-1', workspaceId: 'workspace-1', uploadToken: 'signed-token' },
      })
    ).resolves.toEqual({ import: running })
    expect(mocks.resourceFromUpload).not.toHaveBeenCalled()
  })

  it('resolves a workspace-file source canonically inside the authorized import command', async () => {
    await createTableImportUseCase.execute({
      principal: reader,
      input: {
        body: {
          workspaceId: 'workspace-1',
          source: { type: 'workspace_file', fileId: 'file-1' },
          target: record.target,
        },
      },
    })

    expect(mocks.getWorkspaceFile).toHaveBeenLastCalledWith('workspace-1', 'file-1', {
      throwOnError: true,
    })
    expect(mocks.createResource).toHaveBeenCalledWith(expect.objectContaining({ workspaceFile }))
  })

  it('conceals a cross-workspace workspace-file id before import mutation', async () => {
    mocks.getWorkspaceFile.mockResolvedValueOnce(null)

    await expect(
      createTableImportUseCase.execute({
        principal: reader,
        input: {
          body: {
            workspaceId: 'workspace-1',
            source: { type: 'workspace_file', fileId: 'file-other' },
            target: record.target,
          },
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.createResource).not.toHaveBeenCalled()
  })

  it('lets a workspace key cancel the durable workspace resource', async () => {
    await cancelTableImportUseCase.execute({
      principal: workspaceKey,
      input: { importId: 'import-1', workspaceId: 'workspace-1' },
    })

    expect(mocks.cancelResource).toHaveBeenCalledWith(record)
  })

  it('preserves exact principal and token binding on upload control legs', async () => {
    const request = new Request('http://localhost:3000/api/v2/tables/imports/import-1/parts', {
      method: 'POST',
    })
    await createTableImportPartsUseCase.execute({
      principal: workspaceKey,
      input: {
        importId: 'import-1',
        workspaceId: 'workspace-1',
        uploadToken: 'signed-token',
        partNumbers: [1],
      },
      request,
    })
    await cancelTableImportUseCase.execute({
      principal: workspaceKey,
      input: {
        importId: 'import-1',
        workspaceId: 'workspace-1',
        uploadToken: 'signed-token',
      },
    })
    await completeTableImportUseCase.execute({
      principal: workspaceKey,
      input: {
        importId: 'import-1',
        workspaceId: 'workspace-1',
        uploadToken: 'signed-token',
      },
    })

    expect(mocks.getUpload).toHaveBeenNthCalledWith(1, {
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: workspaceKey,
      uploadToken: 'signed-token',
    })
    expect(mocks.getUpload).toHaveBeenNthCalledWith(2, {
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: workspaceKey,
      uploadToken: 'signed-token',
    })
    expect(mocks.getUpload).toHaveBeenNthCalledWith(3, {
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: workspaceKey,
      uploadToken: 'signed-token',
    })
    expect(mocks.abortUpload).toHaveBeenCalledWith(upload, workspaceKey)
    expect(mocks.assertUploadBinding).toHaveBeenCalledWith(upload, workspaceKey)
  })

  it('threads the exact executor principal through upload control and finalization', async () => {
    const request = new Request('http://localhost:3000/api/table/imports/import-1/parts', {
      method: 'POST',
    })

    await createTableImportPartsUseCase.execute({
      principal: executor,
      input: {
        importId: 'import-1',
        workspaceId: 'workspace-1',
        uploadToken: 'signed-token',
        partNumbers: [1],
      },
      request,
    })
    await completeTableImportUseCase.execute({
      principal: executor,
      input: {
        importId: 'import-1',
        workspaceId: 'workspace-1',
        uploadToken: 'signed-token',
      },
    })

    expect(mocks.getUpload).toHaveBeenNthCalledWith(1, {
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: executor,
      uploadToken: 'signed-token',
    })
    expect(mocks.getUpload).toHaveBeenNthCalledWith(2, {
      importId: 'import-1',
      assertedWorkspaceId: 'workspace-1',
      principal: executor,
      uploadToken: 'signed-token',
    })
    expect(mocks.assertUploadBinding).toHaveBeenCalledWith(upload, executor)
  })

  it('rejects delegated HTTP import creation before canonical load or mutation', async () => {
    const delegated = {
      kind: 'delegated' as const,
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'copilot-tool:tool-1',
      audience: 'sim:tables',
      issuedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2099-08-01T00:00:00.000Z'),
    }

    await expect(
      createTableImportUseCase.execute({
        principal: delegated as never,
        input: {
          body: {
            workspaceId: 'workspace-1',
            source: record.source,
            target: record.target,
          },
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.resolveTableContext).not.toHaveBeenCalled()
    expect(mocks.createResource).not.toHaveBeenCalled()
  })
})
