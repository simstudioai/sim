/**
 * @vitest-environment node
 */
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

import {
  ActiveFileMetadataKeyConflictError,
  deleteFileMetadataByIdentity,
  insertFileMetadata,
  insertFileMetadataMany,
  insertImmutableFileMetadata,
} from '@/lib/uploads/server/metadata'

describe('deleteFileMetadataByIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports whether the exact active file version was soft-deleted', async () => {
    const identity = {
      id: 'file-1',
      key: 'kb/workspace-1/file.pdf',
      context: 'knowledge-base' as const,
      contentUpdatedAt: new Date('2026-08-05T00:00:00.000Z'),
    }
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: identity.id }])

    await expect(deleteFileMetadataByIdentity(identity)).resolves.toBe(true)
    const predicate = dbChainMockFns.where.mock.calls[0]?.[0] as SQL
    const query = new PgDialect().sqlToQuery(predicate)
    expect(query.sql).toContain(
      `date_trunc('milliseconds', "workspace_files"."content_updated_at")`
    )
    expect(query.params).toContain(identity.contentUpdatedAt)

    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(deleteFileMetadataByIdentity(identity)).resolves.toBe(false)
  })
})

describe('insertFileMetadata content versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('advances the content version when a replacement upload restores a deleted row', async () => {
    const deleted = {
      id: 'file-1',
      key: 'workspace/workspace-1/file.txt',
      deletedAt: new Date('2026-08-03T00:00:00.000Z'),
      contentUpdatedAt: new Date('2026-08-03T00:00:00.000Z'),
    }
    const restored = {
      ...deleted,
      deletedAt: null,
      contentUpdatedAt: new Date('2026-08-04T00:00:00.000Z'),
    }
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([deleted])
    dbChainMockFns.returning.mockResolvedValueOnce([restored])

    await expect(
      insertFileMetadata({
        key: deleted.key,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        context: 'workspace',
        originalName: 'file.txt',
        contentType: 'text/plain',
        size: 12,
      })
    ).resolves.toEqual(restored)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ contentUpdatedAt: expect.anything() })
    )
  })

  it('retains legacy active-key reuse for deterministic replacement uploads', async () => {
    const active = {
      id: 'file-1',
      key: 'workspace/workspace-1/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      folderId: null,
      context: 'workspace',
      originalName: 'file.txt',
      contentType: 'text/plain',
      size: 12,
      deletedAt: null,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([active])

    await expect(
      insertFileMetadata({
        key: active.key,
        userId: 'user-2',
        workspaceId: 'workspace-1',
        context: 'workspace',
        originalName: 'other.txt',
        contentType: 'text/plain',
        size: 12,
      })
    ).resolves.toEqual(active)

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects active-key reuse for immutable upload metadata', async () => {
    const active = {
      id: 'file-1',
      key: 'workspace/workspace-1/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      folderId: null,
      context: 'workspace',
      originalName: 'file.txt',
      contentType: 'text/plain',
      size: 12,
      deletedAt: null,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([active])

    await expect(
      insertImmutableFileMetadata({
        key: active.key,
        userId: 'user-2',
        workspaceId: 'workspace-1',
        context: 'workspace',
        originalName: 'other.txt',
        contentType: 'text/plain',
        size: 12,
      })
    ).rejects.toBeInstanceOf(ActiveFileMetadataKeyConflictError)

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('preserves exact-identity idempotence', async () => {
    const active = {
      id: 'file-1',
      key: 'workspace/workspace-1/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      folderId: null,
      context: 'workspace',
      originalName: 'file.txt',
      contentType: 'text/plain',
      size: 12,
      deletedAt: null,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([active])

    await expect(
      insertImmutableFileMetadata({
        key: active.key,
        userId: active.userId,
        workspaceId: active.workspaceId,
        context: active.context,
        originalName: active.originalName,
        contentType: active.contentType,
        size: active.size,
      })
    ).resolves.toEqual(active)

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('insertFileMetadataMany active-key idempotence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const row = {
    key: 'knowledge-base/workspace-1/document.pdf',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    folderId: null,
    context: 'knowledge-base' as const,
    originalName: 'document.pdf',
    contentType: 'application/pdf',
    size: 12,
  }

  it('accepts an exact retry after a concurrent insert', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(workspaceFiles, [{ id: 'file-1', ...row, deletedAt: null }])

    await expect(insertFileMetadataMany([row])).resolves.toBeUndefined()
  })

  it('rejects a conflicting active row instead of silently adopting it', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(workspaceFiles, [
      { id: 'file-1', ...row, userId: 'different-user', deletedAt: null },
    ])

    await expect(insertFileMetadataMany([row])).rejects.toBeInstanceOf(
      ActiveFileMetadataKeyConflictError
    )
  })

  it('deduplicates exact same-key rows before inserting', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'file-1', ...row, deletedAt: null }])

    await expect(insertFileMetadataMany([row, { ...row }])).resolves.toBeUndefined()

    expect(dbChainMockFns.values).toHaveBeenCalledWith([expect.objectContaining({ key: row.key })])
  })

  it('rejects mismatched same-batch rows before writing either identity', async () => {
    await expect(
      insertFileMetadataMany([row, { ...row, userId: 'different-user' }])
    ).rejects.toBeInstanceOf(ActiveFileMetadataKeyConflictError)

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
