/**
 * @vitest-environment node
 */
import { workspaceFileSecretProvenance, workspaceFiles } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  copyWorkspaceFileSecretProvenanceInTx,
  filterModelSafeWorkspaceFileAttachments,
  preserveWorkspaceFileSecretProvenanceInTx,
  replaceWorkspaceFileSecretProvenanceInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

describe('workspace file secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('stores exact entries in deterministic code-unit order without duplicates', async () => {
    await replaceWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      'file-1',
      CONTENT_UPDATED_AT,
      {
        status: 'exact',
        entries: [
          { name: 'z', encryptedValue: 'b' },
          { name: 'a', encryptedValue: 'z' },
          { name: 'a', encryptedValue: 'a' },
          { name: 'z', encryptedValue: 'b' },
        ],
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        contentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [
          { name: 'a', encryptedValue: 'a' },
          { name: 'a', encryptedValue: 'z' },
          { name: 'z', encryptedValue: 'b' },
        ],
      })
    )
  })

  it('preserves provenance only from the exact preceding content version', async () => {
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    queueTableRows(workspaceFileSecretProvenance, [{ contentUpdatedAt: CONTENT_UPDATED_AT }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileId: 'file-1' }])

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      'file-1',
      CONTENT_UPDATED_AT,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ contentUpdatedAt: nextContentUpdatedAt })
    )
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('cannot heal stale provenance during a later preserving write', async () => {
    const staleContentUpdatedAt = new Date('2026-08-03T00:00:00.000Z')
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    queueTableRows(workspaceFileSecretProvenance, [{ contentUpdatedAt: staleContentUpdatedAt }])

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      'file-1',
      CONTENT_UPDATED_AT,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        contentUpdatedAt: nextContentUpdatedAt,
        status: 'unknown',
        entries: [],
      })
    )
  })

  it('treats only canonically bound, unclassified workspace files as model-safe', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'safe-id',
        key: 'safe-key',
        workspaceId: 'workspace-1',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
      {
        id: 'tainted-id',
        key: 'tainted-key',
        workspaceId: 'workspace-1',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
      },
      {
        id: 'unknown-id',
        key: 'unknown-key',
        workspaceId: 'workspace-1',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unknown',
        entries: [],
      },
      {
        id: 'other-workspace-id',
        key: 'other-workspace-key',
        workspaceId: 'workspace-2',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])

    const attachments = [
      { id: 'safe-id', key: 'safe-key' },
      { id: 'wrong-id', key: 'safe-key' },
      { id: 'tainted-id', key: 'tainted-key' },
      { id: 'unknown-id', key: 'unknown-key' },
      { id: 'other-workspace-id', key: 'other-workspace-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ]

    await expect(
      filterModelSafeWorkspaceFileAttachments(attachments, { workspaceId: 'workspace-1' })
    ).resolves.toEqual([
      { id: 'safe-id', key: 'safe-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ])
  })

  it('fails closed when persisted provenance is malformed', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'file-1',
        key: 'file-key',
        workspaceId: 'workspace-1',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [{ name: '', encryptedValue: 'encrypted' }],
      },
    ])

    await expect(
      filterModelSafeWorkspaceFileAttachments([{ id: 'file-1', key: 'file-key' }], {
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual([])
  })

  it('fails closed when provenance belongs to an older content version', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'file-1',
        key: 'file-key',
        workspaceId: 'workspace-1',
        fileContentUpdatedAt: new Date('2026-08-04T00:00:01.000Z'),
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
    ])

    await expect(
      filterModelSafeWorkspaceFileAttachments([{ id: 'file-1', key: 'file-key' }], {
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual([])
  })

  it('copies exact provenance only when it belongs to the source content version', async () => {
    const targetContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          contentUpdatedAt: targetContentUpdatedAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'source-key',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      {
        fileId: 'source-file',
        key: 'source-key',
        contentUpdatedAtMs: CONTENT_UPDATED_AT.getTime(),
      },
      'target-file'
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'target-file',
        contentUpdatedAt: targetContentUpdatedAt,
        status: 'exact',
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
      })
    )
  })

  it('marks a copied file unknown when source provenance is stale', async () => {
    const sourceContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    const targetContentUpdatedAt = new Date('2026-08-04T00:00:02.000Z')
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          contentUpdatedAt: targetContentUpdatedAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'source-key',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          fileContentUpdatedAt: sourceContentUpdatedAt,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      {
        fileId: 'source-file',
        key: 'source-key',
        contentUpdatedAtMs: sourceContentUpdatedAt.getTime(),
      },
      'target-file'
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'target-file',
        contentUpdatedAt: targetContentUpdatedAt,
        status: 'unknown',
        entries: [],
      })
    )
  })

  it('does not remint named provenance into a copied file with a different owner scope', async () => {
    const targetContentUpdatedAt = new Date('2026-08-04T00:00:02.000Z')
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          userId: 'target-user',
          workspaceId: 'target-workspace',
          contentUpdatedAt: targetContentUpdatedAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'source-key',
          userId: 'source-user',
          workspaceId: 'source-workspace',
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      {
        fileId: 'source-file',
        key: 'source-key',
        contentUpdatedAtMs: CONTENT_UPDATED_AT.getTime(),
      },
      'target-file'
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'target-file',
        contentUpdatedAt: targetContentUpdatedAt,
        status: 'unknown',
        entries: [],
      })
    )
  })

  it('marks the copy unknown when the source changed after planning', async () => {
    const nextSourceContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    const targetContentUpdatedAt = new Date('2026-08-04T00:00:02.000Z')
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          contentUpdatedAt: targetContentUpdatedAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'new-source-key',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          fileContentUpdatedAt: nextSourceContentUpdatedAt,
          provenanceContentUpdatedAt: nextSourceContentUpdatedAt,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'new-encrypted-value' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbOrTx,
      {
        fileId: 'source-file',
        key: 'old-source-key',
        contentUpdatedAtMs: CONTENT_UPDATED_AT.getTime(),
      },
      'target-file'
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'target-file',
        contentUpdatedAt: targetContentUpdatedAt,
        status: 'unknown',
        entries: [],
      })
    )
  })
})
