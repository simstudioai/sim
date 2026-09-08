/**
 * @vitest-environment node
 */
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

import {
  ActiveFileMetadataKeyConflictError,
  deleteFileMetadataByIdentity,
  insertFileMetadata,
  insertFileMetadataMany,
  insertImmutableFileMetadata,
  recordKnowledgeBaseFileOwnership,
  resolveStoredFileContext,
} from '@/lib/uploads/server/metadata'

describe('recordKnowledgeBaseFileOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('uses the supplied transaction executor for the immutable ownership binding', async () => {
    const ownership = {
      key: 'kb/fork-document-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      originalName: 'document.pdf',
      contentType: 'application/pdf',
      size: 321,
    }
    const returning = vi.fn().mockResolvedValue([{ id: 'file-1', ...ownership }])
    const select = vi.fn()
    const onConflictDoNothing = vi.fn(() => ({ returning }))
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing })),
    }))
    const executor = { select, insert } as unknown as DbTransaction

    await expect(recordKnowledgeBaseFileOwnership(ownership, executor)).resolves.toBeUndefined()

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('retains the existing non-transactional retry behavior when no executor is supplied', async () => {
    const ownership = {
      key: 'kb/manual-document.pdf',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      originalName: 'document.pdf',
      contentType: 'application/pdf',
      size: 321,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'file-1',
        ...ownership,
        sizeBytes: ownership.size,
        folderId: null,
        context: 'knowledge-base',
        deletedAt: null,
      },
    ])

    await expect(recordKnowledgeBaseFileOwnership(ownership)).resolves.toBeUndefined()

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('validates an exact active binding after a conflict without aborting the executor', async () => {
    const ownership = {
      key: 'kb/fork-document-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      originalName: 'document.pdf',
      contentType: 'application/pdf',
      size: 321,
    }
    const active = {
      id: 'file-1',
      ...ownership,
      sizeBytes: ownership.size,
      folderId: null,
      context: 'knowledge-base',
      deletedAt: null,
    }
    const limit = vi.fn().mockResolvedValue([active])
    const select = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ for: vi.fn(() => ({ limit })) })) })),
    }))
    const returning = vi.fn().mockResolvedValue([])
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => ({ returning })) })),
    }))
    const executor = { select, insert } as unknown as DbTransaction

    await expect(recordKnowledgeBaseFileOwnership(ownership, executor)).resolves.toBeUndefined()

    expect(insert).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
  })
})

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
    expect(query.params).toContain(identity.contentUpdatedAt.toISOString())
    expect(query.params.some((parameter) => parameter instanceof Date)).toBe(false)

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
      sizeBytes: 12,
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
      sizeBytes: 12,
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
      sizeBytes: 12,
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
        size: active.sizeBytes,
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
    queueTableRows(workspaceFiles, [{ id: 'file-1', ...row, sizeBytes: row.size, deletedAt: null }])

    await expect(insertFileMetadataMany([row])).resolves.toBeUndefined()
  })

  it('rejects a conflicting active row instead of silently adopting it', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(workspaceFiles, [
      {
        id: 'file-1',
        ...row,
        sizeBytes: row.size,
        userId: 'different-user',
        deletedAt: null,
      },
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

describe('resolveStoredFileContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const workspaceKey = 'workspace/workspace-1/1234567890-abcdef-photo.png'

  it('reports a mothership attachment stored under a workspace key', async () => {
    queueTableRows(workspaceFiles, [
      { id: 'file-1', key: workspaceKey, context: 'mothership', deletedAt: null },
    ])

    await expect(resolveStoredFileContext(workspaceKey)).resolves.toBe('mothership')
  })

  it('keeps a workspace file on the workspace context', async () => {
    queueTableRows(workspaceFiles, [
      { id: 'file-1', key: workspaceKey, context: 'workspace', deletedAt: null },
    ])

    await expect(resolveStoredFileContext(workspaceKey)).resolves.toBe('workspace')
  })

  it('falls back to the inferred context for an unbound key', async () => {
    await expect(resolveStoredFileContext(workspaceKey)).resolves.toBe('workspace')
  })

  it('trusts the prefix without a lookup when it cannot be a workspace key', async () => {
    await expect(resolveStoredFileContext('copilot/file.png')).resolves.toBe('copilot')

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

describe('organization connector cache ownership', () => {
  const options = {
    key: 'kb/organization-document.txt',
    userId: 'user-1',
    workspaceId: null,
    organizationId: 'org-1',
    folderId: null,
    context: 'knowledge-base' as const,
    originalName: 'document.txt',
    contentType: 'text/plain',
    size: 12,
  }
  const active = { id: 'file-1', ...options, sizeBytes: options.size, deletedAt: null }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('persists organization caches with no personal or workspace owner', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([active])
    await expect(insertImmutableFileMetadata(options)).resolves.toEqual(active)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: null,
        context: 'knowledge-base',
        folderId: null,
      })
    )
  })

  it.each([
    { workspaceId: 'workspace-1' },
    { folderId: 'folder-1' },
    { context: 'workspace' as const },
    { key: 'copilot/user-1/file.txt' },
  ])('rejects an organization binding outside the cache boundary: %j', async (override) => {
    await expect(insertImmutableFileMetadata({ ...options, ...override })).rejects.toThrow(
      'Organization file bindings'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not adopt another organization cache through the legacy replacement helper', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([active])
    await expect(
      insertFileMetadata({ ...options, organizationId: 'org-2' })
    ).rejects.toBeInstanceOf(ActiveFileMetadataKeyConflictError)
  })

  it('does not convert an existing organization cache into a personal upload', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([active])
    await expect(insertFileMetadata({ ...options, organizationId: null })).rejects.toBeInstanceOf(
      ActiveFileMetadataKeyConflictError
    )
  })

  it('does not reassign a deleted organization cache to another owner', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...active, deletedAt: new Date() }])
    await expect(
      insertImmutableFileMetadata({ ...options, organizationId: 'org-2' })
    ).rejects.toBeInstanceOf(ActiveFileMetadataKeyConflictError)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not overwrite a binding restored by a competing registration', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...active, deletedAt: new Date() }])
      .mockResolvedValueOnce([{ ...active, organizationId: 'org-2' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(insertImmutableFileMetadata(options)).rejects.toBeInstanceOf(
      ActiveFileMetadataKeyConflictError
    )
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
  })

  it('rejects a different organization on an immutable batch conflict', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    queueTableRows(workspaceFiles, [active])
    await expect(
      insertFileMetadataMany([{ ...options, organizationId: 'org-2' }])
    ).rejects.toBeInstanceOf(ActiveFileMetadataKeyConflictError)
  })
})
