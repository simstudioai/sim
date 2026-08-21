/**
 * @vitest-environment node
 */
import { workspaceFileSecretProvenance, workspaceFiles } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import {
  areModelSafeWorkspaceFileKeys,
  copyWorkspaceFileSecretProvenanceInTx,
  filterModelSafeWorkspaceFileAttachments,
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
  })

  it('keeps the legacy logical-byte budget when storing an anonymous entry', async () => {
    await replaceWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      {
        status: 'exact',
        entries: [
          {
            encryptedValue: 'x'.repeat(8 * 1024 * 1024 - 1),
            sourceUserId: 'u',
          },
        ],
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            name: 'MOUNTED_FILE_SECRET',
            sourceUserId: 'u',
            anonymous: true,
          }),
        ],
      })
    )
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

  it('binds the database content version within its JavaScript-visible millisecond', async () => {
    await replaceWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'file-1',
      CONTENT_UPDATED_AT,
      { status: 'exact', entries: [] }
    )

    expect(dbChainMockFns.where.mock.calls.at(-1)?.[0]).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'workspaceFiles.id', right: 'file-1' },
        { type: 'gte', left: 'workspaceFiles.contentUpdatedAt', right: CONTENT_UPDATED_AT },
        {
          type: 'lt',
          left: 'workspaceFiles.contentUpdatedAt',
          right: new Date(CONTENT_UPDATED_AT.getTime() + 1),
        },
        { type: 'inArray', column: 'workspaceFiles.context', values: ['workspace', 'mothership'] },
        {
          type: 'or',
          conditions: [
            { type: 'isNull', column: 'workspaceFiles.secretProvenanceVersion' },
            { type: 'eq', left: 'workspaceFiles.secretProvenanceVersion', right: 1 },
          ],
        },
      ],
    })
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
      { id: 'pre-marker-sidecar-id', key: 'pre-marker-sidecar-key' },
      { id: 'synthetic-execution-id', key: 'untracked-context-key' },
      { id: 'legacy-id', key: 'legacy-key' },
      { id: 'inline-file' },
    ])
  })

  it('accepts a server-authorized clean or legacy key without requiring a caller file id', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'clean-id',
        key: 'clean-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
    ])

    await expect(
      isModelSafeWorkspaceFileKey('clean-key', { workspaceId: 'workspace-1' })
    ).resolves.toBe(true)

    queueTableRows(workspaceFiles, [
      {
        id: 'legacy-id',
        key: 'legacy-key',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: null,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])

    await expect(isModelSafeWorkspaceFileKey('legacy-key')).resolves.toBe(true)
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

  it('imports the complete sidecar for an exact model-visible file view', async () => {
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
          { name: 'API_KEY', encryptedValue: 'encrypted-original', sourceUserId: 'user-1' },
          { name: 'API_KEY', encryptedValue: 'encrypted-representation', sourceUserId: 'user-1' },
        ],
      },
    ])

    await expect(
      importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry,
        view: 'complete',
      })
    ).resolves.toBe(true)
    expect(registry.importProvenance).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        entries: [
          { name: 'API_KEY', encryptedValue: 'encrypted-original' },
          { name: 'API_KEY', encryptedValue: 'encrypted-representation' },
        ],
        scope: { userId: 'user-1' },
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )
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

  it('filters tracked provenance against the exact derived model view', async () => {
    const registry = {
      importProvenanceForValue: vi.fn().mockResolvedValue(true),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(false),
    } as unknown as ResolvedSecretTraceRegistry
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted', sourceUserId: 'user-1' }],
      },
    ])

    await expect(
      importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry,
        view: 'derived',
        value: 'derived text',
      })
    ).resolves.toBe(true)
    expect(registry.importProvenanceForValue).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted' }],
        scope: { userId: 'user-1' },
      },
      'derived text',
      { trusted: true, origin: 'durableProvenance.valueEnvelope' }
    )
  })

  it('rejects unavailable mounted-file provenance without importing it', async () => {
    const registry = {
      importProvenance: vi.fn(),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(false),
    } as unknown as ResolvedSecretTraceRegistry
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'unknown',
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

  it('rejects tracked mounted-file provenance when no complete runtime registry can import it', async () => {
    const row = {
      fileContentUpdatedAt: CONTENT_UPDATED_AT,
      secretProvenanceVersion: 1,
      provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
      status: 'exact',
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
    }
    queueTableRows(workspaceFiles, [row])

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
      })
    ).resolves.toBe(false)

    const incompleteRegistry = {
      importProvenance: vi.fn().mockResolvedValue(true),
      isPermanentlyIncomplete: vi.fn().mockReturnValue(true),
    } as unknown as ResolvedSecretTraceRegistry
    queueTableRows(workspaceFiles, [row])

    await expect(
      importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: 'workspace-1',
        identity: { fileId: 'file-1', key: 'file-key', context: 'workspace' },
        registry: incompleteRegistry,
      })
    ).resolves.toBe(false)
  })

  it('rejects a tainted, unknown, stale, or cross-workspace model egress key', async () => {
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

  it('checks a document batch once while preserving missing and non-workspace legacy keys', async () => {
    queueTableRows(workspaceFiles, [
      {
        id: 'clean-id',
        key: 'clean-key',
        workspaceId: 'workspace-1',
        context: 'mothership',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: CONTENT_UPDATED_AT,
        status: 'exact',
        entries: [],
      },
      {
        id: 'knowledge-id',
        key: 'knowledge-key',
        workspaceId: 'workspace-1',
        context: 'knowledge-base',
        fileContentUpdatedAt: CONTENT_UPDATED_AT,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: null,
        status: null,
        entries: null,
      },
    ])

    await expect(
      areModelSafeWorkspaceFileKeys(['clean-key', 'knowledge-key', 'missing-key'], {
        workspaceId: 'workspace-1',
      })
    ).resolves.toBe(true)

    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
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

  it('keeps accepted legacy bytes untracked across a preserving write', async () => {
    const nextContentUpdatedAt = new Date('2026-08-04T00:00:01.000Z')

    await preserveWorkspaceFileSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      'legacy-file',
      CONTENT_UPDATED_AT,
      null,
      nextContentUpdatedAt
    )

    expect(dbChainMockFns.values).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
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

  it('preserves anonymous provenance across a byte-identical file copy', async () => {
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
        entries: [
          {
            name: 'MOUNTED_FILE_SECRET',
            anonymous: true,
            encryptedValue: 'anonymous-encrypted',
            sourceUserId: 'user-1',
          },
        ],
      })
    )
  })

  it('keeps an untouched legacy file untracked when copied', async () => {
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

    expect(dbChainMockFns.values).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
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
