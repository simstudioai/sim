/**
 * @vitest-environment node
 */

import { dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  loadAuthorizationWorkspace: vi.fn(),
  resolveKnowledgeBase: vi.fn(),
  resolveArchivedKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveAccess: vi.fn(),
  attachConnectors: vi.fn(),
  resolveFolderPath: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  listRecords: vi.fn(),
  listLegacyPersonalRecords: vi.fn(),
  listVisibleRecords: vi.fn(),
  getRecord: vi.fn(),
  getRestorableRecord: vi.fn(),
  performUpdate: vi.fn(),
  performDelete: vi.fn(),
  performRestore: vi.fn(),
  loadFolderIndex: vi.fn(),
  recordAudit: vi.fn(),
  knowledgeBaseDeleted: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
    KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
    KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
    KNOWLEDGE_BASE_RESTORED: 'knowledge_base.restored',
  },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
  recordAudit: mocks.recordAudit,
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

vi.mock('@/lib/knowledge/access/scope', () => ({
  resolveKnowledgeAccessScope: mocks.resolveAccess,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDeleted: mocks.knowledgeBaseDeleted },
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  loadKnowledgeWorkspaceAuthorizationContext: mocks.loadAuthorizationWorkspace,
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveArchivedKnowledgeBaseContext: mocks.resolveArchivedKnowledgeBase,
}))

vi.mock('@/lib/knowledge/application/folder-paths', () => ({
  resolveKnowledgeFolderPath: mocks.resolveFolderPath,
  knowledgeFolderPathForId: () => '/',
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  getConfiguredKbEmbedding: () => ({ model: 'text-embedding-3-small', dimensions: 1536 }),
}))

vi.mock('@/lib/knowledge/service', () => ({
  createAuthorizedKnowledgeBase: mocks.createRecord,
  updateKnowledgeBase: mocks.updateRecord,
  deleteKnowledgeBase: mocks.deleteRecord,
  getKnowledgeBaseById: mocks.getRecord,
  getLegacyPersonalKnowledgeBases: mocks.listLegacyPersonalRecords,
  listWorkspaceAndLegacyKnowledgeBases: mocks.listVisibleRecords,
  getWorkspaceKnowledgeBases: mocks.listRecords,
  attachKnowledgeBaseConnectors: mocks.attachConnectors,
}))

vi.mock('@/lib/knowledge/orchestration', () => ({
  getRestorableKnowledgeBase: mocks.getRestorableRecord,
  performUpdateKnowledgeBase: mocks.performUpdate,
  performDeleteKnowledgeBase: mocks.performDelete,
  performRestoreKnowledgeBase: mocks.performRestore,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  bulkDeleteKnowledgeBases,
  createKnowledgeBase,
  deleteInternalKnowledgeBase,
  listInternalKnowledgeBases,
  listKnowledgeBaseCatalog,
  listKnowledgeBases,
  readInternalKnowledgeBase,
  readKnowledgeBase,
  restoreInternalKnowledgeBase,
  restoreKnowledgeBase,
  updateInternalKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'billing-owner-1',
  name: 'Docs',
  description: null,
  tokenCount: 0,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  workspaceId: 'workspace-1',
  folderId: null,
  docCount: 0,
  connectorTypes: [],
}

describe('knowledge base application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAccess.mockResolvedValue({ kind: 'workspace', tokens: ['workspace', 'public'] })
    mocks.attachConnectors.mockImplementation(async (kb) => kb)
    mocks.resolveWorkspace.mockResolvedValue(context)
    mocks.loadAuthorizationWorkspace.mockResolvedValue(context)
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
      access: { get: mocks.resolveAccess },
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveFolderPath.mockResolvedValue({
      folderId: null,
      index: { pathById: new Map(), idByPath: new Map(), rowById: new Map() },
    })
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map(), idByPath: new Map() })
    mocks.createRecord.mockResolvedValue(knowledgeBase)
    mocks.listRecords.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.listLegacyPersonalRecords.mockResolvedValue([knowledgeBase])
    mocks.listVisibleRecords.mockResolvedValue([knowledgeBase])
    mocks.getRecord.mockResolvedValue(knowledgeBase)
    mocks.getRestorableRecord.mockResolvedValue(knowledgeBase)
    mocks.resolveArchivedKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      restorableKnowledgeBase: {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
        deletedAt: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.performUpdate.mockResolvedValue({
      success: true,
      knowledgeBase: { ...knowledgeBase, name: 'Renamed' },
    })
    mocks.performDelete.mockResolvedValue({ success: true })
    mocks.performRestore.mockResolvedValue({ success: true, knowledgeBase })
    mocks.updateRecord.mockResolvedValue({ ...knowledgeBase, name: 'Renamed' })
    mocks.deleteRecord.mockResolvedValue(undefined)
  })

  /**
   * The folder filter is a filter like any other: a path naming no active folder
   * narrows the list to nothing instead of failing it. Reaching the row query
   * with no folder id would return every knowledge base in the workspace.
   */
  it('returns an empty page for a folder path that matches no folder', async () => {
    const result = await listKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', folderPath: '/does-not-exist' },
    })

    expect(result).toMatchObject({ knowledgeBases: [], nextCursorKeys: null })
    expect(mocks.listRecords).not.toHaveBeenCalled()
    expect(mocks.resolveFolderPath).not.toHaveBeenCalled()
  })

  it('lists legacy personal knowledge bases through the explicit session-only operation', async () => {
    await expect(
      listInternalKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { scope: 'all' },
      })
    ).resolves.toEqual({ knowledgeBases: [knowledgeBase] })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.listLegacyPersonalRecords).toHaveBeenCalledWith('user-1', 'all')
  })

  it('authorizes a canonical workspace before listing its internal knowledge bases', async () => {
    await listInternalKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', scope: 'archived' },
    })

    expect(mocks.resolveWorkspace).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.listVisibleRecords).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'archived',
      expect.objectContaining({ kind: 'workspace' })
    )
    expect(mocks.listLegacyPersonalRecords).not.toHaveBeenCalled()
  })

  /**
   * Workspace `admin` can come from an organization role alone, with no workspace permission
   * row behind it. Re-deriving list access from that row would hide every knowledge base from
   * a caller the create path already authorizes — a base they make and then cannot see.
   */
  it('lists a workspace for an authorized caller who holds no workspace permission row', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.listVisibleRecords.mockResolvedValueOnce([knowledgeBase])

    await expect(
      listInternalKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'org-admin-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', scope: 'active' },
      })
    ).resolves.toEqual({ knowledgeBases: [knowledgeBase] })

    expect(mocks.listVisibleRecords).toHaveBeenCalledWith(
      'org-admin-1',
      'workspace-1',
      'active',
      expect.objectContaining({ kind: 'workspace' })
    )
  })

  it('loads the active knowledge catalog and tag metadata only after workspace authorization', async () => {
    mocks.listRecords.mockResolvedValueOnce({ data: [knowledgeBase], nextCursorKeys: null })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      {
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'tag1',
        displayName: 'Department',
        fieldType: 'text',
      },
    ])

    const result = await listKnowledgeBaseCatalog.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'vfs-1',
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: { workspaceId: 'workspace-1' },
    })

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listRecords.mock.invocationCallOrder[0]
    )
    expect(result.knowledgeBases).toEqual([
      expect.objectContaining({
        knowledgeBase,
        tagDefinitions: [
          {
            knowledgeBaseId: 'knowledge-1',
            tagSlot: 'tag1',
            displayName: 'Department',
            fieldType: 'text',
          },
        ],
      }),
    ])
  })

  it('rejects an archived Knowledge list bound to another trusted workspace before reading', async () => {
    await expect(
      listKnowledgeBases.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'dual-workspace-user',
          workspaceId: 'workspace-b',
          delegationId: 'vfs-1',
          audience: 'sim:knowledge',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: { workspaceId: 'workspace-1', scope: 'archived' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.listRecords).not.toHaveBeenCalled()
  })

  it('rejects a workspace listing before reading when current access is insufficient', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      listInternalKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', scope: 'active' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listLegacyPersonalRecords).not.toHaveBeenCalled()
  })

  it('rejects non-session principals before resolving internal list input', async () => {
    await expect(
      listInternalKnowledgeBases.execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        input: { scope: 'active' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.listLegacyPersonalRecords).not.toHaveBeenCalled()
  })

  it('rejects an insufficient role before the protected mutation', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('read')

    await expect(
      createKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', name: 'Docs' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.createRecord).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('uses billing ownership only for the workspace-key compatibility column', async () => {
    await createKnowledgeBase.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      },
      input: { workspaceId: 'workspace-1', name: 'Docs', source: 'v2' },
    })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1', workspaceId: 'workspace-1' }),
      expect.any(String)
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.create',
          actor: {
            kind: 'workspace_api_key',
            keyId: 'workspace-key-1',
            workspaceId: 'workspace-1',
          },
        }),
      })
    )
  })

  it('passes the internal folder ID through only after workspace authorization', async () => {
    await createKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'workspace-1',
        name: 'Docs',
        folderId: 'folder-1',
        source: 'ui',
      },
    })

    expect(mocks.loadFolderIndex).toHaveBeenCalledWith(
      'workspace-1',
      'knowledge_base',
      undefined,
      expect.any(Object)
    )
    expect(mocks.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1' }),
      expect.any(String)
    )
  })

  it('conceals a canonical scope mismatch and never audits it', async () => {
    mocks.resolveKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    await expect(
      readKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates infrastructure failures without audit', async () => {
    const failure = new Error('database unavailable')
    mocks.createRecord.mockRejectedValueOnce(failure)

    await expect(
      createKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', name: 'Docs' },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('carries the canonical workspace predicate into the locked update', async () => {
    await updateKnowledgeBaseOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        name: 'Renamed',
      },
    })

    expect(mocks.updateRecord).toHaveBeenCalledWith(
      'knowledge-1',
      expect.objectContaining({ name: 'Renamed' }),
      expect.any(String),
      { assertedWorkspaceId: 'workspace-1' }
    )
  })

  it('reads a legacy personal knowledge base only for its owning session', async () => {
    const personalKnowledgeBase = {
      ...knowledgeBase,
      userId: 'user-1',
      workspaceId: null,
    }
    mocks.getRecord.mockResolvedValueOnce(personalKnowledgeBase)

    await expect(
      readInternalKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1' },
      })
    ).resolves.toEqual({ knowledgeBase: personalKnowledgeBase })
    expect(mocks.loadAuthorizationWorkspace).not.toHaveBeenCalled()
  })

  it('authorizes the canonical workspace before an internal detail read', async () => {
    await readInternalKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { knowledgeBaseId: 'knowledge-1' },
    })

    expect(mocks.loadAuthorizationWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(mocks.resolvePermission).toHaveBeenCalled()
  })

  it('authorizes both canonical workspaces before moving a knowledge base', async () => {
    mocks.resolveWorkspace.mockResolvedValueOnce({ ...context, workspaceId: 'workspace-2' })

    await updateInternalKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { knowledgeBaseId: 'knowledge-1', workspaceId: 'workspace-2' },
    })

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
    expect(mocks.performUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        updates: expect.objectContaining({ workspaceId: 'workspace-2' }),
      })
    )
  })

  it('rejects a destination workspace before an internal move mutation', async () => {
    mocks.resolveWorkspace.mockResolvedValueOnce({ ...context, workspaceId: 'workspace-2' })
    mocks.resolvePermission.mockResolvedValueOnce('write').mockResolvedValueOnce(null)

    await expect(
      updateInternalKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1', workspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.performUpdate).not.toHaveBeenCalled()
  })

  /**
   * The internal restore delegates its workspace branch to the shared
   * `restoreKnowledgeBase` use case, so the archived context — which is what
   * loads the workspace with `includeArchived` — is resolved there rather than
   * in the internal wrapper. What must stay true is that the mutation runs only
   * after authorization, and that the shared use case suppresses the
   * orchestration's own audit so the restore is recorded once.
   */
  it('carries canonical scope into internal delete and restores only after authorization', async () => {
    const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
    await deleteInternalKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1' },
    })
    await restoreInternalKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: 'knowledge-1' },
    })

    expect(mocks.performDelete).toHaveBeenCalledWith(
      expect.objectContaining({ assertedWorkspaceId: 'workspace-1' })
    )
    expect(mocks.resolveArchivedKnowledgeBase).toHaveBeenCalledWith({
      knowledgeBaseId: 'knowledge-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.performRestore).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: 'knowledge-1', recordSemanticAudit: false })
    )
  })

  it('restores a workspace knowledge base only after the operation authorizes', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      restoreInternalKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.performRestore).not.toHaveBeenCalled()
  })

  /**
   * Restore is the inverse of delete, so a principal that can archive a
   * knowledge base must be able to recover it. A tighter policy here would
   * strand rows a workspace API key deleted.
   */
  it('reaches restore under the same policy as delete', () => {
    expect(knowledgeOperations.restore.minimumRole).toBe(knowledgeOperations.delete.minimumRole)
    expect(knowledgeOperations.restore.workspaceApiKey).toBe(
      knowledgeOperations.delete.workspaceApiKey
    )
  })

  /**
   * The orchestration call and the audit projection must agree on which surface
   * asked: the internal route restores as `ui` and the public one as `api`, and
   * a literal in the orchestration call would attribute both to whichever one
   * it names.
   */
  it.each([['ui' as const], ['api' as const], ['agent' as const]])(
    'restores with the calling surface, not a fixed one (%s)',
    async (source) => {
      await restoreKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-1', source },
      })

      expect(mocks.performRestore).toHaveBeenCalledWith(expect.objectContaining({ source }))
    }
  )

  it('carries the internal surface through the shared restore use case', async () => {
    await restoreInternalKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { knowledgeBaseId: 'knowledge-1' },
    })

    expect(mocks.performRestore).toHaveBeenCalledWith(expect.objectContaining({ source: 'ui' }))
  })

  it('answers an already-active knowledge base without restoring or auditing it', async () => {
    mocks.resolveArchivedKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      restorableKnowledgeBase: {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
        deletedAt: null,
      },
    })

    const result = await restoreKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        source: 'api',
      },
    })

    expect(result.restored).toBe(false)
    expect(result.knowledgeBase.id).toBe('knowledge-1')
    expect(mocks.performRestore).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('reads the archived set through the same list, keyset, and reader as the active one', async () => {
    mocks.listRecords.mockResolvedValue({ data: [knowledgeBase], nextCursorKeys: ['k', 'id'] })

    const result = await listKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'workspace-1',
        scope: 'archived',
        search: 'docs',
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: 25,
        cursorKeys: ['2026-01-01T00:00:00.000Z', 'knowledge-0'],
      },
    })

    expect(mocks.listRecords).toHaveBeenCalledWith('workspace-1', 'archived', {
      access: expect.objectContaining({ kind: 'workspace' }),
      folderId: undefined,
      search: 'docs',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      limit: 25,
      cursorKeys: ['2026-01-01T00:00:00.000Z', 'knowledge-0'],
    })
    expect(result.nextCursorKeys).toEqual(['k', 'id'])
  })

  it('bounds bulk deletion before canonical workspace loading', async () => {
    await expect(
      bulkDeleteKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: Array.from({ length: 101 }, (_, index) => `knowledge-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
  })

  it('conceals a cross-workspace bulk target before mutation for a dual-workspace subject', async () => {
    mocks.resolveKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    const result = await bulkDeleteKnowledgeBases.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'dual-workspace-user',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['workspace-2-knowledge'],
      },
    })

    expect(result).toMatchObject({ deleted: [], notFound: ['workspace-2-knowledge'] })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'dual-workspace-user',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('returns explicit best-effort outcomes and audits only authoritative deletions', async () => {
    mocks.resolveKnowledgeBase.mockImplementation(async ({ knowledgeBaseId }) => ({
      ...context,
      knowledgeBaseId,
      knowledgeBase: { ...knowledgeBase, id: knowledgeBaseId, name: `Name ${knowledgeBaseId}` },
    }))
    mocks.deleteRecord
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new OrchestrationError('conflict', 'Knowledge base is locked'))

    const result = await bulkDeleteKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        source: 'agent',
      },
    })

    expect(result).toMatchObject({
      deleted: [{ id: 'knowledge-1', name: 'Name knowledge-1' }],
      failed: [{ id: 'knowledge-2', name: 'Name knowledge-2', reason: 'Knowledge base is locked' }],
      cancelled: false,
    })
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(3)
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'knowledge-1',
        metadata: expect.objectContaining({ operation: 'knowledge.bulk_delete' }),
      })
    )
    expect(mocks.knowledgeBaseDeleted).toHaveBeenCalledWith({ knowledgeBaseId: 'knowledge-1' })
  })

  it('stops between bulk mutations while auditing completed items', async () => {
    const controller = new AbortController()
    mocks.resolveKnowledgeBase.mockImplementation(async ({ knowledgeBaseId }) => ({
      ...context,
      knowledgeBaseId,
      knowledgeBase: { ...knowledgeBase, id: knowledgeBaseId, name: knowledgeBaseId },
    }))
    mocks.deleteRecord.mockImplementationOnce(async () => {
      controller.abort('user stopped')
    })

    const result = await bulkDeleteKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        cancellationSignal: controller.signal,
      },
    })

    expect(result).toMatchObject({ deleted: [{ id: 'knowledge-1' }], cancelled: true })
    expect(mocks.deleteRecord).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('audits completed knowledge base deletions before propagating infrastructure failure', async () => {
    const failure = new Error('knowledge store unavailable')
    mocks.resolveKnowledgeBase.mockImplementation(async ({ knowledgeBaseId }) => ({
      ...context,
      knowledgeBaseId,
      knowledgeBase: { ...knowledgeBase, id: knowledgeBaseId, name: knowledgeBaseId },
    }))
    mocks.deleteRecord.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)

    await expect(
      bulkDeleteKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'knowledge-1' })
    )
    expect(mocks.knowledgeBaseDeleted).toHaveBeenCalledOnce()
  })
})
