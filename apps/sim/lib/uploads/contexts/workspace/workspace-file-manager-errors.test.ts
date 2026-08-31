/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceFiles, loadActiveWorkspaceFileContext } from './workspace-file-manager'

afterAll(resetDbChainMock)

describe('listWorkspaceFiles error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))
  })

  it('keeps the established best-effort behavior by default', async () => {
    await expect(listWorkspaceFiles('workspace-1')).resolves.toEqual([])
  })

  it('propagates failures when a caller requires an authoritative list', async () => {
    await expect(listWorkspaceFiles('workspace-1', { throwOnError: true })).rejects.toThrow(
      'database unavailable'
    )
  })

  it('contains asynchronous record-mapping failures by default', async () => {
    dbChainMockFns.orderBy.mockReset()
    queueTableRows(schemaMock.workspaceFiles, [
      {
        id: 'file-1',
        key: 'workspace/workspace-1/file-1.md',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        folderId: null,
        originalName: 'file-1.md',
        contentType: 'text/markdown',
        sizeBytes: null,
        width: null,
        height: null,
        deletedAt: null,
        uploadedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        contentUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    await expect(listWorkspaceFiles('workspace-1')).resolves.toEqual([])
  })

  it('propagates asynchronous record-mapping failures for authoritative callers', async () => {
    dbChainMockFns.orderBy.mockReset()
    queueTableRows(schemaMock.workspaceFiles, [
      {
        id: 'file-1',
        key: 'workspace/workspace-1/file-1.md',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        folderId: null,
        originalName: 'file-1.md',
        contentType: 'text/markdown',
        sizeBytes: null,
        width: null,
        height: null,
        deletedAt: null,
        uploadedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        contentUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    await expect(listWorkspaceFiles('workspace-1', { throwOnError: true })).rejects.toThrow(
      'Workspace file is missing canonical size_bytes metadata'
    )
  })
})

describe('loadActiveWorkspaceFileContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the canonical workspace authorization context', async () => {
    const context = {
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    }
    dbChainMockFns.limit.mockResolvedValueOnce([context])

    await expect(loadActiveWorkspaceFileContext('file-1')).resolves.toEqual(context)
  })

  it('returns null when the active file does not exist', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(loadActiveWorkspaceFileContext('missing-file')).resolves.toBeNull()
  })

  it('propagates database failures', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(loadActiveWorkspaceFileContext('file-1')).rejects.toThrow('database unavailable')
  })
})
