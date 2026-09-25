import { workspaceFileSecretProvenance, workspaceFiles } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReportWrite, mockReportRefusal, mockFindWorkspaceFileVersionKeys } = vi.hoisted(() => ({
  mockReportWrite: vi.fn(),
  mockReportRefusal: vi.fn(),
  mockFindWorkspaceFileVersionKeys: vi.fn(async () => new Set<string>()),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-versions', () => ({
  findWorkspaceFileVersionKeys: mockFindWorkspaceFileVersionKeys,
}))

vi.mock('@/lib/execution/durable-secret-provenance-telemetry', () => ({
  reportDurableSecretProvenanceWrite: mockReportWrite,
  reportDurableSecretProvenanceRefusal: mockReportRefusal,
}))

import type { DbTransaction } from '@/lib/db/types'
import { PROVENANCE_MAX_ENTRIES } from '@/lib/execution/provenance-limits'
import {
  areModelSafeWorkspaceFileKeys,
  copyWorkspaceFileSecretProvenanceInTx,
  createWorkspaceFileSecretProvenanceFromRegistry,
  filterModelSafeWorkspaceFileAttachments,
  getBoundWorkspaceFileSecretProvenance,
  importWorkspaceFileSecretProvenanceForModelView,
  importWorkspaceFileSecretProvenanceForRuntime,
  initializeWorkspaceFileSecretProvenanceInTx,
  isModelSafeWorkspaceFileKey,
  isOpaqueWorkspaceFileEgressSafe,
  mergeWorkspaceFileSecretProvenance,
  preserveWorkspaceFileSecretProvenanceInTx,
  replaceWorkspaceFileSecretProvenanceInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

describe('execution file sidecars at model boundaries', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    { status: 'exact', version: 1, stale: false, entries: [], safe: true },
    { status: 'unknown', version: 1, stale: false, entries: [], safe: false },
    { status: 'exact', version: 1, stale: true, entries: [], safe: false },
    { status: null, version: 1, stale: false, entries: null, safe: false },
    { status: 'unknown', version: null, stale: true, entries: [], safe: true },
    {
      status: 'exact',
      version: 1,
      stale: false,
      entries: [{ name: 'KEY', encryptedValue: 'ciphertext', sourceUserId: 'writer' }],
      safe: false,
    },
  ])(
    'classifies execution bytes consistently: %j',
    async ({ status, version, stale, entries, safe }) => {
      const key = 'execution/workspace-1/workflow-1/execution-1/file.zip'
      const row = {
        key,
        workspaceId: 'workspace-1',
        context: 'execution',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: version,
        provenanceContentUpdatedAt: stale ? new Date(0) : CONTENT_UPDATED_AT,
        status,
        entries,
      }

      queueTableRows(workspaceFiles, [row])
      expect(await isModelSafeWorkspaceFileKey(key, { workspaceId: 'workspace-1' })).toBe(safe)
      queueTableRows(workspaceFiles, [row])
      expect(
        await filterModelSafeWorkspaceFileAttachments([{ id: 'invented-id', key }], {
          workspaceId: 'workspace-1',
        })
      ).toEqual(safe ? [{ id: 'invented-id', key }] : [])
      queueTableRows(workspaceFiles, [row])
      const bound = await getBoundWorkspaceFileSecretProvenance('workspace-1', {
        fileId: 'canonical-id',
        key,
        context: 'execution',
        contentUpdatedAt: CONTENT_UPDATED_AT,
      })
      expect(bound.status).toBe(
        version === null || (status === 'exact' && !stale) ? 'exact' : 'unknown'
      )
    }
  )
})

describe('workspace file secret provenance', () => {
  beforeEach(() => {
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
          { encryptedValue: 'anonymous', sourceUserId: 'user-1' },
          { name: 'z', encryptedValue: 'b', sourceUserId: 'user-1' },
          { name: 'a', encryptedValue: 'z', sourceUserId: 'user-1' },
          { name: 'a', encryptedValue: 'a', sourceUserId: 'user-1' },
          { name: 'z', encryptedValue: 'b', sourceUserId: 'user-1' },
        ],
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        contentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [
          {
            name: 'MOUNTED_FILE_SECRET',
            encryptedValue: 'anonymous',
            sourceUserId: 'user-1',
            anonymous: true,
          },
          { name: 'a', encryptedValue: 'a', sourceUserId: 'user-1' },
          { name: 'a', encryptedValue: 'z', sourceUserId: 'user-1' },
          { name: 'z', encryptedValue: 'b', sourceUserId: 'user-1' },
        ],
      })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledWith(workspaceFiles)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
    expect(mockReportWrite).not.toHaveBeenCalled()
  })

  it('rejects entries beyond the legacy logical-byte budget', async () => {
    await expect(
      replaceWorkspaceFileSecretProvenanceInTx(
        dbChainMock.db as unknown as DbTransaction,
        'file-1',
        CONTENT_UPDATED_AT,
        {
          status: 'exact',
          entries: [
            {
              encryptedValue: 'x'.repeat(8 * 1024 * 1024),
              sourceUserId: 'u',
            },
          ],
        }
      )
    ).rejects.toThrow('exceeds its size limit')

    expect(dbChainMockFns.values).not.toHaveBeenCalled()
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

  it('persists a refused write as unknown, not as an absence', async () => {
    await replaceWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      { status: 'unknown' }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', status: 'unknown', entries: [] })
    )
    expect(mockReportWrite).toHaveBeenCalledWith({
      surface: 'workspace-file',
      status: 'unknown',
      cause: 'workspace-file-write-unknown',
      resourceId: 'file-1',
    })
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

  it('classifies attachments by their canonical storage key without requiring a database file id', async () => {
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
        entries: [
          { name: 'API_KEY', encryptedValue: 'encrypted-original', sourceUserId: 'user-1' },
          { name: 'API_KEY', encryptedValue: 'encrypted-representation', sourceUserId: 'user-1' },
        ],
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
        id: 'unrecorded-id',
        key: 'unrecorded-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unrecorded',
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
        entries: [{ name: 'STALE', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
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
      { key: 'safe-key' },
      { id: 'file-1700000000000', key: 'safe-key' },
      { id: 'tracked-no-sidecar-id', key: 'tracked-no-sidecar-key' },
      { id: 'wrong-id', key: 'safe-key' },
      { id: 'safe-id', key: 'tainted-key' },
      { id: 'unknown-id', key: 'unknown-key' },
      { id: 'unrecorded-id', key: 'unrecorded-key' },
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
      { key: 'safe-key' },
      { id: 'file-1700000000000', key: 'safe-key' },
      { id: 'wrong-id', key: 'safe-key' },
      /**
       * Unrecorded, so kept — the untracked keys below say the same thing and always were. The
       * stored `unknown` above is dropped: a writer refused those bytes on purpose, which is a
       * different claim from nobody having recorded them, and no policy relaxes it.
       */
      { id: 'pre-marker-sidecar-id', key: 'pre-marker-sidecar-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ])
  })

  it('allows opaque egress only for exact-empty or legacy file provenance', async () => {
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])
    await expect(
      isOpaqueWorkspaceFileEgressSafe('workspace-1', {
        fileId: 'legacy-file',
        key: 'legacy-key',
        context: 'workspace',
      })
    ).resolves.toBe(true)

    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
      },
    ])
    await expect(
      isOpaqueWorkspaceFileEgressSafe('workspace-1', {
        fileId: 'tracked-file',
        key: 'tracked-key',
        context: 'workspace',
      })
    ).resolves.toBe(false)
  })

  it('imports exact mounted-file provenance and keeps legacy-null files compatible', async () => {
    const registry = {
      importProvenance: vi.fn().mockResolvedValue(true),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(false),
    } as unknown as ResolvedSecretTraceRegistry
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [
          {
            name: '__SIM_INTERNAL_ANONYMOUS_SECRET_PROVENANCE_V1__',
            encryptedValue: 'encrypted',
            sourceUserId: 'user-1',
          },
        ],
      },
    ])

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry,
      })
    ).resolves.toBe(true)
    expect(registry.importProvenance).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        entries: [
          {
            name: '__SIM_INTERNAL_ANONYMOUS_SECRET_PROVENANCE_V1__',
            encryptedValue: 'encrypted',
          },
        ],
        scope: { userId: 'user-1' },
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )

    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [
          {
            name: ':SIM_INTERNAL_ANONYMOUS_SECRET_PROVENANCE_V1:',
            encryptedValue: 'reserved-name-encrypted',
            sourceUserId: 'user-1',
          },
        ],
      },
    ])
    vi.mocked(registry.importProvenance).mockClear()

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'reserved-name-file', key: 'reserved-name-key', context: 'workspace' },
        registry,
      })
    ).resolves.toBe(true)
    expect(registry.importProvenance).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        entries: [
          {
            encryptedValue: 'reserved-name-encrypted',
          },
        ],
        scope: { userId: 'user-1' },
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )

    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [
          {
            name: ':SIM_INTERNAL_ANONYMOUS_SECRET_PROVENANCE_V1:',
            anonymous: true,
            encryptedValue: 'anonymous-encrypted',
            sourceUserId: 'user-1',
          },
        ],
      },
    ])
    vi.mocked(registry.importProvenance).mockClear()

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'anonymous-file', key: 'anonymous-key', context: 'workspace' },
        registry,
      })
    ).resolves.toBe(true)
    expect(registry.importProvenance).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        entries: [{ encryptedValue: 'anonymous-encrypted' }],
        scope: { userId: 'user-1' },
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )

    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])
    vi.mocked(registry.importProvenance).mockClear()

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'legacy-file', key: 'legacy-key', context: 'workspace' },
        registry,
      })
    ).resolves.toBe(true)
    expect(registry.importProvenance).not.toHaveBeenCalled()
  })

  it('rejects a contributor identity captured from an older file content version', async () => {
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])

    await expect(
      importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: 'workspace-1',
        identity: {
          fileId: 'file-1',
          key: 'file-key',
          context: 'workspace',
          contentUpdatedAt: new Date(CONTENT_UPDATED_AT.getTime() - 1),
        },
        view: 'opaque',
      })
    ).resolves.toBe(false)
  })

  it('rejects derived content views of tracked files', async () => {
    const registry = {
      importProvenance: vi.fn().mockResolvedValue(true),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(false),
    } as unknown as ResolvedSecretTraceRegistry
    const trackedRow = {
      fileContentUpdatedAt: CONTENT_UPDATED_AT,
      secretProvenanceVersion: 1,
      provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
      status: 'exact',
      entries: [{ name: 'MULTILINE', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
    }
    queueTableRows(workspaceFiles, [trackedRow])

    await expect(
      importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry,
        view: 'derived',
      })
    ).resolves.toBe(false)
    expect(registry.importProvenance).not.toHaveBeenCalled()
  })

  /**
   * Unrecorded says exactly what an untracked file says, and that one has always mounted. There is
   * nothing to import either way, so the mount proceeds and the workspace is told.
   */
  it('refuses to mount an unrecorded tracked file', async () => {
    const registry = {
      importProvenance: vi.fn(),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(false),
    } as unknown as ResolvedSecretTraceRegistry
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unrecorded',
        entries: [],
      },
    ])

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry,
      })
    ).resolves.toBe(false)
    expect(registry.importProvenance).not.toHaveBeenCalled()
  })

  it('rejects a tainted, stale, or cross-workspace model egress key', async () => {
    const rejectedRows = [
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
        id: 'stale-id',
        key: 'stale-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: new Date('2026-08-04T00:00:01.000Z'),
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
    ]

    for (const row of rejectedRows) {
      queueTableRows(workspaceFiles, [row])
      await expect(isModelSafeWorkspaceFileKey(row.key)).resolves.toBe(false)
    }

    queueTableRows(workspaceFiles, [
      {
        id: 'other-id',
        key: 'other-key',
        workspaceId: 'workspace-2',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])
    await expect(
      isModelSafeWorkspaceFileKey('other-key', { workspaceId: 'workspace-1' })
    ).resolves.toBe(false)
  })

  it('refuses a retained version key rather than treating it as an untracked legacy key', async () => {
    queueTableRows(workspaceFiles, [])
    mockFindWorkspaceFileVersionKeys.mockResolvedValueOnce(new Set(['old-version-key']))

    await expect(
      areModelSafeWorkspaceFileKeys(['old-version-key'], { workspaceId: 'workspace-1' })
    ).resolves.toBe(false)
    expect(mockFindWorkspaceFileVersionKeys).toHaveBeenCalledWith(['old-version-key'])
  })

  it('rejects a document batch when any canonical workspace file is tainted', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'clean-id',
        key: 'clean-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
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
    ])

    await expect(
      areModelSafeWorkspaceFileKeys(['clean-key', 'tainted-key'], {
        workspaceId: 'workspace-1',
      })
    ).resolves.toBe(false)
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
        {
          status: 'exact',
          entries: [{ name: 'A', encryptedValue: 'encrypted-a', sourceUserId: 'user-1' }],
        },
        {
          status: 'exact',
          entries: [{ name: 'B', encryptedValue: 'encrypted-b', sourceUserId: 'user-1' }],
        }
      )
    ).toEqual({
      status: 'exact',
      entries: [
        { name: 'A', encryptedValue: 'encrypted-a', sourceUserId: 'user-1' },
        { name: 'B', encryptedValue: 'encrypted-b', sourceUserId: 'user-1' },
      ],
    })
    expect(
      mergeWorkspaceFileSecretProvenance({ status: 'exact', entries: [] }, { status: 'unknown' })
    ).toEqual({ status: 'unknown' })
  })

  it('counts distinct merged entries at the actual entry boundary and refuses overflow', () => {
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES }, (_, index) => ({
      sourceUserId: 'user-1',
      encryptedValue: `ciphertext-${index}`,
    }))
    const full = { status: 'exact' as const, entries }
    expect(mergeWorkspaceFileSecretProvenance(full, full)).toEqual(full)
    expect(
      mergeWorkspaceFileSecretProvenance(full, {
        status: 'exact',
        entries: [{ sourceUserId: 'user-1', encryptedValue: 'one-more-secret' }],
      })
    ).toEqual({ status: 'unknown' })
  })

  it('does not discard known secret entries when another contributor is unrecorded', () => {
    const known = {
      status: 'exact' as const,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
    }
    const unrecorded = { status: 'unrecorded' as const }
    expect(mergeWorkspaceFileSecretProvenance(known, unrecorded)).toEqual({ status: 'unknown' })
    expect(mergeWorkspaceFileSecretProvenance(unrecorded, known)).toEqual({ status: 'unknown' })
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
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
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
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
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

  it('refuses an unrecorded tracked file', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'unrecorded-id',
        key: 'unrecorded-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unrecorded',
        entries: [],
      },
    ])

    await expect(isModelSafeWorkspaceFileKey('unrecorded-key')).resolves.toBe(false)
    expect(mockReportRefusal).toHaveBeenCalledWith({
      surface: 'workspace-file',
      cause: 'workspace-file-unrecorded-enforced',
      workspaceId: undefined,
    })
  })

  it('still lets an unknown contribution dominate an unrecorded one', () => {
    expect(
      mergeWorkspaceFileSecretProvenance({ status: 'unrecorded' }, { status: 'unknown' })
    ).toEqual({ status: 'unknown' })
  })
})

describe('createWorkspaceFileSecretProvenanceFromRegistry write decision', () => {
  const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }

  /**
   * A registry latched with nothing resolved is an absence, not a taint: no plaintext exists in
   * the context to be in the bytes, so the writer records an absence instead of known taint.
   * Stamping taint here made one failed workflow run hard-refuse every file its chat later wrote.
   */
  it('classifies a latched registry holding no active entries as unrecorded', async () => {
    const registry = {
      exportCommittedProvenanceForValue: vi.fn(() => ({
        version: 1,
        complete: false,
        entries: [],
      })),
      getIncompletenessDiagnostics: vi.fn(() => ({
        reasons: ['value-provenance-absent'],
        origins: [],
        incompleteInputPathCount: 0,
        activeEntryCount: 0,
      })),
    } as unknown as ResolvedSecretTraceRegistry

    await expect(
      createWorkspaceFileSecretProvenanceFromRegistry(registry, 'generated content', SCOPE)
    ).resolves.toEqual({ safe: true, provenance: { status: 'unrecorded' } })
  })

  /**
   * Zero active entries does not prove the context never held plaintext: a verification or
   * decrypt fault trips while secret material is in flight, before anything activates. Only a
   * latch whose recorded reasons all belong to the registry's absence set may relax.
   */
  it.each([
    ['an originating fault', 'projection-mismatch'],
    /**
     * Warn-level, yet plaintext-bearing: it latches after a staged source registry decrypted
     * real entries it could not narrow to the value — the report-level split must not be the
     * absence split.
     */
    ['an unnarrowable crossing', 'value-provenance-filter-incomplete'],
  ] as const)(
    'keeps a latch caused by %s as a taint even with no active entries',
    async (_, reason) => {
      const registry = {
        exportCommittedProvenanceForValue: vi.fn(() => ({
          version: 1,
          complete: false,
          entries: [],
        })),
        getIncompletenessDiagnostics: vi.fn(() => ({
          reasons: [reason],
          origins: [],
          incompleteInputPathCount: 0,
          activeEntryCount: 0,
        })),
      } as unknown as ResolvedSecretTraceRegistry

      await expect(
        createWorkspaceFileSecretProvenanceFromRegistry(registry, 'generated content', SCOPE)
      ).resolves.toEqual({ safe: false })
    }
  )

  it('keeps a latched registry holding plaintext it cannot map as a taint', async () => {
    const registry = {
      exportCommittedProvenanceForValue: vi.fn(() => ({
        version: 1,
        complete: false,
        entries: [],
      })),
      getIncompletenessDiagnostics: vi.fn(() => ({
        reasons: ['source-provenance-incomplete'],
        origins: [],
        incompleteInputPathCount: 0,
        activeEntryCount: 1,
      })),
    } as unknown as ResolvedSecretTraceRegistry

    await expect(
      createWorkspaceFileSecretProvenanceFromRegistry(registry, 'generated content', SCOPE)
    ).resolves.toEqual({ safe: false })
  })
})
