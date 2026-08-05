/**
 * @vitest-environment node
 */
import { workspaceFileSecretProvenance, workspaceFiles } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import {
  copyWorkspaceFileSecretProvenanceInTx,
  filterModelSafeWorkspaceFileAttachments,
  initializeWorkspaceFileSecretProvenanceInTx,
  mergeWorkspaceFileSecretProvenance,
  preserveWorkspaceFileSecretProvenanceInTx,
  replaceWorkspaceFileSecretProvenanceInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

describe('workspace file secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'tracked-file' }])
  })

  it('stores exact entries in deterministic code-unit order without duplicates', async () => {
    await replaceWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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
    expect(dbChainMockFns.update).toHaveBeenCalledWith(workspaceFiles)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
  })

  it('initializes a missing classification without replacing an existing one', async () => {
    await initializeWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      { status: 'exact', entries: [] }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        contentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      })
    )
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.onConflictDoUpdate).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
  })

  it('rejects a marker write that cannot bind the exact tracked content version', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      replaceWorkspaceFileSecretProvenanceInTx(
        dbChainMock.db as unknown as DbTransaction,
        'stale-file',
        CONTENT_UPDATED_AT,
        { status: 'exact', entries: [] }
      )
    ).rejects.toThrow('could not bind the tracked content version')
  })

  it('preserves provenance only from the exact preceding content version', async () => {
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    queueTableRows(workspaceFileSecretProvenance, [{ contentUpdatedAt: CONTENT_UPDATED_AT }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileId: 'file-1' }])

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      1,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ contentUpdatedAt: nextContentUpdatedAt })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('cannot heal stale provenance during a later preserving write', async () => {
    const staleContentUpdatedAt = new Date('2026-08-03T00:00:00.000Z')
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')
    queueTableRows(workspaceFileSecretProvenance, [{ contentUpdatedAt: staleContentUpdatedAt }])

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      1,
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

  it('treats only canonically bound untouched legacy files as model-safe without a sidecar', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'safe-id',
        key: 'safe-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
      {
        id: 'tracked-no-sidecar-id',
        key: 'tracked-no-sidecar-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
      {
        id: 'tainted-id',
        key: 'tainted-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
      },
      {
        id: 'unknown-id',
        key: 'unknown-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unknown',
        entries: [],
      },
      {
        id: 'other-workspace-id',
        key: 'other-workspace-key',
        workspaceId: 'workspace-2',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
      {
        id: 'pre-marker-sidecar-id',
        key: 'pre-marker-sidecar-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
      {
        id: 'untracked-context-id',
        key: 'untracked-context-key',
        workspaceId: null,
        context: 'execution',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])

    const attachments = [
      { id: 'safe-id', key: 'safe-key' },
      { id: 'tracked-no-sidecar-id', key: 'tracked-no-sidecar-key' },
      { id: 'wrong-id', key: 'safe-key' },
      { id: 'tainted-id', key: 'tainted-key' },
      { id: 'unknown-id', key: 'unknown-key' },
      { id: 'other-workspace-id', key: 'other-workspace-key' },
      { id: 'pre-marker-sidecar-id', key: 'pre-marker-sidecar-key' },
      { id: 'synthetic-execution-id', key: 'untracked-context-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ]

    await expect(
      filterModelSafeWorkspaceFileAttachments(attachments, { workspaceId: 'workspace-1' })
    ).resolves.toEqual([
      { id: 'safe-id', key: 'safe-key' },
      { id: 'pre-marker-sidecar-id', key: 'pre-marker-sidecar-key' },
      { id: 'synthetic-execution-id', key: 'untracked-context-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ])
  })

  it('preserves accepted legacy bytes as explicit exact-empty after the first tracked write', async () => {
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'legacy-file',
      CONTENT_UPDATED_AT,
      null,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'legacy-file',
        contentUpdatedAt: nextContentUpdatedAt,
        status: 'exact',
        entries: [],
      })
    )
  })

  it('does not treat a tracked content version with no sidecar as legacy', async () => {
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'tracked-file',
      CONTENT_UPDATED_AT,
      1,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'tracked-file',
        contentUpdatedAt: nextContentUpdatedAt,
        status: 'unknown',
        entries: [],
      })
    )
  })

  it('merges exact byte contributors and propagates unknown classifications', () => {
    expect(
      mergeWorkspaceFileSecretProvenance(
        { status: 'exact', entries: [{ name: 'A', encryptedValue: 'encrypted-a' }] },
        { status: 'exact', entries: [{ name: 'B', encryptedValue: 'encrypted-b' }] }
      )
    ).toEqual({
      status: 'exact',
      entries: [
        { name: 'A', encryptedValue: 'encrypted-a' },
        { name: 'B', encryptedValue: 'encrypted-b' },
      ],
    })
    expect(
      mergeWorkspaceFileSecretProvenance({ status: 'exact', entries: [] }, { status: 'unknown' })
    ).toEqual({ status: 'unknown' })
  })

  it('fails closed when persisted provenance is malformed', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'file-1',
        key: 'file-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        secretProvenanceVersion: 1,
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
        context: 'workspace',
        secretProvenanceVersion: 1,
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

  it('fails closed for an unsupported future provenance version', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'future-file',
        key: 'future-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        secretProvenanceVersion: 2,
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
    ])

    await expect(
      filterModelSafeWorkspaceFileAttachments([{ id: 'future-file', key: 'future-key' }], {
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
          secretProvenanceVersion: 1,
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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

  it('copies an untouched legacy file as explicit exact-empty', async () => {
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
          secretProvenanceVersion: null,
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: null,
          status: null,
          entries: null,
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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
        entries: [],
      })
    )
  })

  it('marks a tracked source with no sidecar unknown when copied', async () => {
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
          secretProvenanceVersion: 1,
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: null,
          status: null,
          entries: null,
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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
          secretProvenanceVersion: 1,
          fileContentUpdatedAt: sourceContentUpdatedAt,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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
          secretProvenanceVersion: 1,
          fileContentUpdatedAt: CONTENT_UPDATED_AT,
          provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
          status: 'exact',
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
        },
      ])

    await copyWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
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
      dbChainMock.db as unknown as DbTransaction,
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
