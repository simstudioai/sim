import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceFiles } from './workspace-file-manager'

afterAll(resetDbChainMock)

describe('listWorkspaceFiles error handling', () => {
  beforeEach(() => {
    resetDbChainMock()
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))
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
