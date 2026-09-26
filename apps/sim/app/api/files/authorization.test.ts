/**
 * Tests for KB file authorization (`verifyKBFileAccess` via `verifyFileAccess`).
 *
 * These lock in the security-critical contract: access is granted only when a
 * trusted ownership binding names a workspace the caller can access AND an active
 * document still references the exact key. A planted `document.fileUrl` (the
 * reported vulnerability) can never grant access because ownership comes from the
 * binding, not the document.
 */

import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindWorkspaceFileVersionKeys } = vi.hoisted(() => ({
  mockFindWorkspaceFileVersionKeys: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-versions', () => ({
  findWorkspaceFileVersionKeys: mockFindWorkspaceFileVersionKeys,
}))

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/executor/constants', () => ({
  isUuid: vi.fn(() => false),
}))

import { type KnowledgeAccessProvider, SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import { verifyFileAccess, verifyKBFileWriteAccess } from '@/app/api/files/authorization'

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
const mockGetFileMetadataByKey = uploadsMetadataMockFns.mockGetFileMetadataByKey
const mockGetFileMetadata = uploadsMockFns.mockGetFileMetadata
fileUtilsMockFns.mockInferContextFromKey.mockImplementation((key: string) =>
  key.startsWith('kb/') ? 'knowledge-base' : key.split('/')[0]
)

const CLOUD_KEY = 'kb/1780162789495-secret.txt'
const USER_ID = 'user-1'

function grantAccess(cloudKey: string) {
  return verifyFileAccess(cloudKey, USER_ID, undefined, 'knowledge-base')
}

describe('verifyKBFileAccess (binding-only)', () => {
  it.each(['mothership', 'profile-pictures', 'general'] as const)(
    'refuses private chat image keys even with misleading %s context',
    async (context) => {
      await expect(
        verifyFileAccess('chat-images/chat/request/image.webp', USER_ID, undefined, context)
      ).resolves.toBe(false)
    }
  )

  it.each(['mothership', 'profile-pictures', 'general'] as const)(
    'refuses organization image keys through legacy %s authorization',
    async (context) => {
      await expect(
        verifyFileAccess('assistant/org-1/user-1/upload-1/image.png', USER_ID, undefined, context)
      ).resolves.toBe(false)
    }
  )
  beforeEach(() => {
    // Default liveness query result: one active document references the exact storage key.
    dbChainMockFns.limit.mockResolvedValue([{ id: 'doc-1' }])
  })

  it('denies when the caller lacks permission on the owner workspace (cross-tenant)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'victim-ws', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue(null)

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })

  it('denies when there is no ownership binding (planted or un-backfilled key)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    // Authorization never consults workspace permissions without a binding.
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when the binding is soft-deleted', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: new Date() })

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when the binding has no workspace owner', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: null, deletedAt: null })

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when no active document references the key (archived/soft-deleted KB liveness)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })

  it('fails closed when the binding lookup throws', async () => {
    mockGetFileMetadataByKey.mockRejectedValue(new Error('db down'))

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })
})

describe('verifyKBFileWriteAccess (binding-only delete authorization)', () => {
  it('denies delete when the caller has only read on the owner workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('read')

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(false)
  })
})

describe('public-context access (profile-pictures / og-images / workspace-logos)', () => {
  function write(cloudKey: string, context: 'profile-pictures' | 'og-images' | 'workspace-logos') {
    return verifyFileAccess(cloudKey, USER_ID, undefined, context, false, { requireWrite: true })
  }

  it('allows organization logo reads and denies generic deletes even for the uploader', async () => {
    const key = 'organization-logos/org-1/logo.png'
    mockGetFileMetadata.mockResolvedValue({ userId: USER_ID })
    await expect(verifyFileAccess(key, USER_ID, undefined, 'organization-logos')).resolves.toBe(
      true
    )
    await expect(
      verifyFileAccess(key, USER_ID, undefined, 'organization-logos', false, { requireWrite: true })
    ).resolves.toBe(false)
    await expect(
      verifyFileAccess(key, USER_ID, undefined, 'general', false, { requireWrite: true })
    ).resolves.toBe(false)
    expect(mockGetFileMetadata).not.toHaveBeenCalled()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies a cross-tenant delete that names a workspace key under a public context', async () => {
    await expect(write('workspace/victim-ws/123-report.pdf', 'og-images')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies a profile-picture delete for a non-owner', async () => {
    mockGetFileMetadata.mockResolvedValue({ userId: 'other-user' })
    await expect(write('profile-pictures/123-avatar.png', 'profile-pictures')).resolves.toBe(false)
  })

  it('denies a workspace-logo delete for a non-member of the owning workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'victim-ws' })
    mockGetUserEntityPermissions.mockResolvedValue(null)
    await expect(write('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(false)
  })

  it('denies a workspace-logo delete when no ownership binding exists', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)
    await expect(write('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})

/**
 * The `workspace/` prefix carries two module contexts — a Files-module workspace
 * file and a mothership chat attachment — and both authorize identically here, by
 * membership of the owning workspace. Filtering the binding lookup to `workspace`
 * alone silently missed every attachment and fell through to object metadata,
 * which cannot see a soft delete.
 */
describe('workspace-scoped access (workspace files and mothership attachments)', () => {
  const ATTACHMENT_KEY = 'workspace/ws-1/1786000000000-a3f2-photo.png'

  beforeEach(() => {
    // No legacy `workspace_file` row and no object metadata, so a denial can only
    // come from the binding itself rather than a fallback happening to grant.
    dbChainMockFns.limit.mockResolvedValue([])
    mockGetFileMetadata.mockResolvedValue({})
    mockFindWorkspaceFileVersionKeys.mockResolvedValue(new Set())
  })

  function read(cloudKey: string, context: 'workspace' | 'mothership') {
    return verifyFileAccess(cloudKey, USER_ID, undefined, context, false)
  }

  interface BoundRow {
    workspaceId: string
    userId: string
    context: string
    deletedAt: Date | null
  }

  /**
   * Installs the single row bound to the key, applying the same `context` and
   * `includeDeleted` filters the real `getFileMetadataByKey` applies. Honoring the
   * arguments is the whole point: a mock that returns the row unconditionally would
   * pass against a lookup hard-filtered to `context = 'workspace'`, which is exactly
   * the bug these tests exist to catch.
   */
  function bindRow(row: BoundRow) {
    mockGetFileMetadataByKey.mockImplementation(
      async (_key: string, context?: string, options?: { includeDeleted?: boolean }) => {
        if (context && row.context !== context) return null
        if (!options?.includeDeleted && row.deletedAt) return null
        return row
      }
    )
  }

  it.each(['workspace', 'mothership'] as const)(
    'grants a %s-context binding on workspace membership',
    async (rowContext) => {
      bindRow({
        workspaceId: 'ws-1',
        userId: USER_ID,
        context: rowContext,
        deletedAt: null,
      })
      mockGetUserEntityPermissions.mockResolvedValue('read')

      await expect(read(ATTACHMENT_KEY, 'workspace')).resolves.toBe(true)
      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER_ID, 'workspace', 'ws-1')
      // The binding answered, so the weaker object-metadata path is never consulted.
      expect(mockGetFileMetadata).not.toHaveBeenCalled()
    }
  )

  it('denies a soft-deleted attachment instead of falling through to object metadata', async () => {
    bindRow({
      workspaceId: 'ws-1',
      userId: USER_ID,
      context: 'mothership',
      deletedAt: new Date('2026-08-01T00:00:00Z'),
    })
    mockGetFileMetadata.mockResolvedValue({ workspaceId: 'ws-1' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    await expect(read(ATTACHMENT_KEY, 'workspace')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies a cross-tenant read of an attachment', async () => {
    bindRow({
      workspaceId: 'victim-ws',
      userId: 'other-user',
      context: 'mothership',
      deletedAt: null,
    })
    mockGetUserEntityPermissions.mockResolvedValue(null)

    await expect(read(ATTACHMENT_KEY, 'workspace')).resolves.toBe(false)
  })

  it('denies a retained version key instead of authorizing it from its object metadata', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)
    mockGetFileMetadata.mockResolvedValue({ workspaceId: 'ws-1' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockFindWorkspaceFileVersionKeys.mockResolvedValue(new Set([ATTACHMENT_KEY]))

    await expect(read(ATTACHMENT_KEY, 'workspace')).resolves.toBe(false)
    expect(mockFindWorkspaceFileVersionKeys).toHaveBeenCalledWith([ATTACHMENT_KEY])
    expect(mockGetFileMetadata).not.toHaveBeenCalled()
  })

  it('does not accept a binding whose context is not workspace-scoped', async () => {
    bindRow({
      workspaceId: 'ws-1',
      userId: USER_ID,
      context: 'copilot',
      deletedAt: null,
    })

    await expect(read(ATTACHMENT_KEY, 'workspace')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})

describe('organization connector cache access', () => {
  beforeEach(() => {
    mockGetFileMetadataByKey.mockResolvedValue({
      workspaceId: null,
      organizationId: 'org-1',
      userId: USER_ID,
      deletedAt: null,
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetFileMetadata.mockResolvedValue({ userId: USER_ID })
    dbChainMockFns.limit.mockResolvedValue([{ id: 'doc-1' }])
  })

  it.each(['general', 'profile-pictures', 'knowledge-base'] as const)(
    'denies the uploader a raw download even with a forged %s context',
    async (context) => {
      await expect(
        verifyFileAccess(CLOUD_KEY, USER_ID, undefined, context, false, { knowledgeAccess: 'user' })
      ).resolves.toBe(false)
      expect(mockGetFileMetadata).not.toHaveBeenCalled()
      expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    }
  )

  it('denies system reads after the cache loses its active document reference', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    await expect(
      verifyFileAccess(CLOUD_KEY, USER_ID, undefined, 'knowledge-base', false, {
        knowledgeAccess: SYSTEM_ACCESS_SCOPE,
      })
    ).resolves.toBe(false)
  })

  it('denies a binding claiming both organization and workspace ownership', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      deletedAt: null,
    })
    await expect(
      verifyFileAccess(CLOUD_KEY, USER_ID, undefined, 'knowledge-base', false, {
        knowledgeAccess: SYSTEM_ACCESS_SCOPE,
      })
    ).resolves.toBe(false)
    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(false)
  })

  it('does not let a raw download endpoint delete organization caches', async () => {
    await expect(
      verifyFileAccess(CLOUD_KEY, USER_ID, undefined, 'general', false, {
        requireWrite: true,
        knowledgeAccess: SYSTEM_ACCESS_SCOPE,
      })
    ).resolves.toBe(false)
  })
})

describe('KB file live source authorization', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('read')
  })

  it.each([true, false])(
    'returns live permission %s after an ordinary file lookup misses',
    async (allowed) => {
      const scope = { kind: 'user' as const, userId: USER_ID, tokens: ['reader-token'] }
      const getForConnectors = vi.fn().mockResolvedValue(scope)
      const liveSources = { type: 'live-sources' }
      const access: KnowledgeAccessProvider = {
        get: async () => scope,
        getForConnectors,
        getForDocuments: async () => scope,
        liveSourceConnectorCondition: async () => liveSources as never,
      }
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.knowledgeConnector, [{ connectorId: 'confluence-source' }])
      queueTableRows(schemaMock.document, allowed ? [{ id: 'doc-1' }] : [])
      await expect(
        verifyFileAccess(CLOUD_KEY, USER_ID, undefined, 'knowledge-base', false, {
          knowledgeAccess: access,
        })
      ).resolves.toBe(allowed)
      expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['confluence-source'], undefined)
      const discovery = dbChainMockFns.where.mock.calls.filter(([condition]) =>
        hasMockCondition(condition, (node) => node === liveSources)
      )
      expect(discovery).toHaveLength(1)
      for (const [condition] of dbChainMockFns.where.mock.calls) {
        if (discovery.some(([live]) => live === condition)) continue
        expect(
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'eq' &&
              node.left === schemaMock.document.storageKey &&
              node.right === CLOUD_KEY
          )
        ).toBe(true)
        expect(
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'eq' &&
              node.left === schemaMock.knowledgeBase.workspaceId &&
              node.right === 'ws-1'
          )
        ).toBe(true)
      }
    }
  )

  it('rejects a missing ownership permission before resolving the reader', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    const get = vi.fn()
    await expect(
      verifyFileAccess(CLOUD_KEY, USER_ID, undefined, 'knowledge-base', false, {
        knowledgeAccess: { get, getForConnectors: vi.fn(), getForDocuments: vi.fn() },
      })
    ).resolves.toBe(false)
    expect(get).not.toHaveBeenCalled()
  })
})

/** Execution downloads share the logs endpoint's current workspace permission check. */
describe('execution file download authorization', () => {
  const executionKey = 'execution/owner-workspace/workflow/run/image.png'

  it('denies a caller without access to the file workspace', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    await expect(verifyFileAccess(executionKey, USER_ID, undefined, 'execution')).resolves.toBe(
      false
    )
  })

  it('rechecks access after membership is revoked', async () => {
    mockGetUserEntityPermissions.mockResolvedValueOnce('read').mockResolvedValueOnce(null)
    await expect(verifyFileAccess(executionKey, USER_ID, undefined, 'execution')).resolves.toBe(
      true
    )
    await expect(verifyFileAccess(executionKey, USER_ID, undefined, 'execution')).resolves.toBe(
      false
    )
  })

  it('denies a malformed execution key before looking up workspace access', async () => {
    await expect(
      verifyFileAccess('execution/image.png', USER_ID, undefined, 'execution')
    ).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
