import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import { requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  bulkDeleteFolders: vi.fn(),
  bulkMoveFolders: vi.fn(),
  planFolderSelection: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/folders/bulk', () => ({
  planFolderSelection: hoisted.planFolderSelection,
  bulkMoveFolders: hoisted.bulkMoveFolders,
  bulkDeleteFolders: hoisted.bulkDeleteFolders,
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
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { bulkDeleteKnowledgeItems, bulkMoveKnowledgeItems } from '@/lib/knowledge/application/bulk'

const mocks = {
  ...hoisted,
  findActiveFolder: folderQueriesMockFns.mockFindActiveFolder,
  updateRecord: knowledgeServiceMockFns.mockUpdateKnowledgeBase,
  deleteRecord: knowledgeServiceMockFns.mockDeleteKnowledgeBase,
}

requestUtilsMockFns.mockGenerateRequestId.mockImplementation(() => 'request-1')

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = createSessionPrincipal()

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
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue(
      workspaceContext
    )
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mocks.planFolderSelection.mockResolvedValue(emptyPlan)
    mocks.findActiveFolder.mockResolvedValue({ id: 'folder-1' })
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseInWorkspace.mockImplementation(
      async (knowledgeBaseId: string) => knowledgeContext(knowledgeBaseId)
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

    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).not.toHaveBeenCalled()
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

    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).not.toHaveBeenCalled()
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
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseInWorkspace.mockImplementation(
      async (knowledgeBaseId: string) => knowledgeContext(knowledgeBaseId, 'folder-child')
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
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseInWorkspace.mockRejectedValueOnce(
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
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'knowledge_base.deleted', resourceId: 'knowledge-1' })
    )
    expect(mocks.bulkDeleteFolders).not.toHaveBeenCalled()
  })
})
