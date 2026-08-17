/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  bulkDeleteFolders: vi.fn(),
  bulkMoveFolders: vi.fn(),
  deleteRecord: vi.fn(),
  findActiveFolder: vi.fn(),
  knowledgeBaseDeleted: vi.fn(),
  planFolderSelection: vi.fn(),
  resolveKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspace: vi.fn(),
  updateRecord: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
    KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
  },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base', FOLDER: 'folder' },
  recordAudit: mocks.audit,
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
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDeleted: mocks.knowledgeBaseDeleted },
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/folders/bulk', () => ({
  planFolderSelection: mocks.planFolderSelection,
  bulkMoveFolders: mocks.bulkMoveFolders,
  bulkDeleteFolders: mocks.bulkDeleteFolders,
  /** Pure projection — mirrored here rather than mocked, so outcomes stay realistic. */
  foldFolderPlan: (
    plan: { notFound: string[]; contained: { id: string; name: string }[] },
    outcome: {
      notFound: { kind: string; id: string }[]
      skipped: { kind: string; id: string; name: string }[]
    }
  ) => {
    for (const id of plan.notFound) outcome.notFound.push({ kind: 'folder', id })
    for (const folder of plan.contained) outcome.skipped.push({ kind: 'folder', ...folder })
  },
}))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mocks.findActiveFolder }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveActiveKnowledgeBaseInWorkspace: mocks.resolveKnowledgeBase,
}))
vi.mock('@/lib/knowledge/service', () => ({
  updateKnowledgeBase: mocks.updateRecord,
  deleteKnowledgeBase: mocks.deleteRecord,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { bulkDeleteKnowledgeItems, bulkMoveKnowledgeItems } from '@/lib/knowledge/application/bulk'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

function knowledgeContext(id: string, folderId: string | null = null) {
  return {
    ...workspaceContext,
    knowledgeBaseId: id,
    knowledgeBase: { id, name: `Base ${id}`, workspaceId: 'workspace-1', folderId },
  }
}

const emptyPlan = { selected: [], notFound: [], contained: [], covered: new Set<string>() }

describe('knowledge bulk application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.planFolderSelection.mockResolvedValue(emptyPlan)
    mocks.findActiveFolder.mockResolvedValue({ id: 'folder-1' })
    mocks.resolveKnowledgeBase.mockImplementation(async (knowledgeBaseId: string) =>
      knowledgeContext(knowledgeBaseId)
    )
    mocks.updateRecord.mockImplementation(async (id: string) => ({ id, name: `Base ${id}` }))
    mocks.deleteRecord.mockResolvedValue(undefined)
    mocks.bulkMoveFolders.mockResolvedValue({ succeeded: [], failed: [] })
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [],
      failed: [],
      folderCount: 0,
      resourceCount: 0,
    })
  })

  it('rejects an empty selection before the canonical workspace load', async () => {
    await expect(
      bulkDeleteKnowledgeItems.execute({
        principal,
        input: { assertedWorkspaceId: 'workspace-1', knowledgeBaseIds: [], folderIds: [] },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
  })

  it('bounds knowledge bases and folders against one combined cap', async () => {
    await expect(
      bulkDeleteKnowledgeItems.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: Array.from({ length: 60 }, (_, index) => `knowledge-${index}`),
          folderIds: Array.from({ length: 60 }, (_, index) => `folder-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
  })

  it('deletes knowledge bases and folders in one operation and audits every affected item', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Policies' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-1']),
    })
    mocks.bulkDeleteFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-1', name: 'Policies' }],
      failed: [],
      folderCount: 3,
      resourceCount: 4,
    })

    const result = await bulkDeleteKnowledgeItems.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        folderIds: ['folder-1'],
      },
    })

    expect(result.deleted).toEqual([
      { kind: 'knowledgeBase', id: 'knowledge-1', name: 'Base knowledge-1' },
      { kind: 'folder', id: 'folder-1', name: 'Policies' },
    ])
    expect(result.deletedItems).toEqual({ knowledgeBases: 5, folders: 3 })
    expect(mocks.audit).toHaveBeenCalledTimes(2)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'knowledge_base.deleted', resourceId: 'knowledge-1' })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'folder.deleted', resourceId: 'folder-1' })
    )
    expect(mocks.knowledgeBaseDeleted).toHaveBeenCalledExactlyOnceWith({
      knowledgeBaseId: 'knowledge-1',
    })
  })

  /**
   * The whole point of taking both id lists in one request: a knowledge base
   * that is also inside a selected folder must be deleted exactly once, by the
   * folder's cascade.
   */
  it('skips a knowledge base that a selected folder already carries', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-1', name: 'Policies' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-1', 'folder-child']),
    })
    mocks.resolveKnowledgeBase.mockImplementation(async (knowledgeBaseId: string) =>
      knowledgeContext(knowledgeBaseId, 'folder-child')
    )

    const result = await bulkDeleteKnowledgeItems.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        folderIds: ['folder-1'],
      },
    })

    expect(result.skipped).toEqual([
      { kind: 'knowledgeBase', id: 'knowledge-1', name: 'Base knowledge-1' },
    ])
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
  })

  it('conceals an inaccessible knowledge base as not-found rather than naming it', async () => {
    mocks.resolveKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    const result = await bulkDeleteKnowledgeItems.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['workspace-2-knowledge'],
        folderIds: [],
      },
    })

    expect(result.notFound).toEqual([{ kind: 'knowledgeBase', id: 'workspace-2-knowledge' }])
    expect(result.failed).toEqual([])
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('fails the whole move when the destination folder is not in the workspace', async () => {
    mocks.findActiveFolder.mockResolvedValue(null)

    await expect(
      bulkMoveKnowledgeItems.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          folderIds: [],
          targetFolderId: 'foreign-folder',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.updateRecord).not.toHaveBeenCalled()
  })

  it('fails the whole move when the destination sits inside the moving subtree', async () => {
    // `covered` is the selected folders plus their descendants. Without an up-front check the
    // knowledge bases move, the folders then fail their own cycle check, and the caller is left
    // with a half-applied selection.
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-2', name: 'Archive' }],
      notFound: [],
      contained: [],
      covered: new Set(['folder-2', 'folder-2-child']),
    })

    for (const targetFolderId of ['folder-2', 'folder-2-child']) {
      await expect(
        bulkMoveKnowledgeItems.execute({
          principal,
          input: {
            assertedWorkspaceId: 'workspace-1',
            knowledgeBaseIds: ['knowledge-1'],
            folderIds: ['folder-2'],
            targetFolderId,
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }

    expect(mocks.updateRecord).not.toHaveBeenCalled()
    expect(mocks.bulkMoveFolders).not.toHaveBeenCalled()
  })

  it('moves knowledge bases and folders in one operation', async () => {
    mocks.planFolderSelection.mockResolvedValue({
      selected: [{ id: 'folder-2', name: 'Archive' }],
      notFound: ['ghost-folder'],
      contained: [{ id: 'folder-3', name: 'Nested' }],
      covered: new Set(['folder-2', 'folder-3']),
    })
    mocks.bulkMoveFolders.mockResolvedValue({
      succeeded: [{ id: 'folder-2', name: 'Archive' }],
      failed: [],
    })

    const result = await bulkMoveKnowledgeItems.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        folderIds: ['folder-2', 'folder-3', 'ghost-folder'],
        targetFolderId: 'folder-1',
      },
    })

    expect(result.moved).toEqual([
      { kind: 'knowledgeBase', id: 'knowledge-1', name: 'Base knowledge-1' },
      { kind: 'folder', id: 'folder-2', name: 'Archive' },
    ])
    expect(result.skipped).toEqual([{ kind: 'folder', id: 'folder-3', name: 'Nested' }])
    expect(result.notFound).toEqual([{ kind: 'folder', id: 'ghost-folder' }])
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      'knowledge-1',
      { folderId: 'folder-1' },
      'request-1',
      { assertedWorkspaceId: 'workspace-1' }
    )
  })

  it('records audit for the committed prefix before rethrowing an infrastructure failure', async () => {
    mocks.deleteRecord.mockImplementation(async (knowledgeBaseId: string) => {
      if (knowledgeBaseId === 'knowledge-2') throw new Error('connection reset')
    })

    await expect(
      bulkDeleteKnowledgeItems.execute({
        principal,
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2', 'knowledge-3'],
          folderIds: [],
        },
      })
    ).rejects.toThrow('connection reset')

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'knowledge_base.deleted', resourceId: 'knowledge-1' })
    )
    expect(mocks.bulkDeleteFolders).not.toHaveBeenCalled()
  })
})
