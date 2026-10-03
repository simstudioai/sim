import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  foldersOrchestrationMock,
  foldersOrchestrationMockFns,
} from '@sim/testing/mocks/folders-orchestration.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)

import { createKnowledgeFolder, listKnowledgeFolders } from '@/lib/knowledge/application/folders'

const mocks = {
  loadIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  listRows: folderQueriesMockFns.mockListActiveFolderRows,
}

const { mockCreateFolderAtPath, mockDeleteFolderByPath } = foldersOrchestrationMockFns

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const folder = {
  id: 'folder-1',
  resourceType: 'knowledge_base',
  name: 'Docs',
  userId: 'billing-owner-1',
  workspaceId: 'workspace-1',
  parentId: null,
  sortOrder: 0,
  locked: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
}

describe('knowledge folder application use cases', () => {
  beforeEach(() => {
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue(context)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mocks.loadIndex.mockResolvedValue({
      idByPath: new Map([['/Docs', 'folder-1']]),
      pathById: new Map([['folder-1', '/Docs']]),
      rowById: new Map([['folder-1', folder]]),
    })
    mocks.listRows.mockResolvedValue([folder])
    mockCreateFolderAtPath.mockResolvedValue({ success: true, folder, path: '/Docs' })
    mockDeleteFolderByPath.mockResolvedValue({
      success: true,
      path: '/Docs',
      deletedItems: { folders: 2, knowledgeBases: 3 },
    })
  })

  it.each(['revoked', 'other-workspace'])(
    'rejects %s Copilot access before listing folders',
    async (reason) => {
      if (reason === 'revoked')
        workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
      await expect(
        listKnowledgeFolders.execute({
          principal: createTrustedCopilotPrincipal(
            {
              userId: 'user-1',
              workspaceId: reason === 'other-workspace' ? 'workspace-2' : 'workspace-1',
              delegationId: 'chat-1',
            },
            { audience: 'sim:knowledge', ttlMs: 60_000 }
          ),
          input: { workspaceId: 'workspace-1' },
        })
      ).rejects.toThrow()
      expect(mocks.loadIndex).not.toHaveBeenCalled()
      expect(mocks.listRows).not.toHaveBeenCalled()
    }
  )

  it('uses compatibility attribution only for storage and key attribution for audit', async () => {
    await createKnowledgeFolder.execute({
      principal: createWorkspaceApiKeyPrincipal(),
      input: { workspaceId: 'workspace-1', path: '/Docs', source: 'v2' },
    })

    expect(mockCreateFolderAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'knowledge_base',
        userId: 'billing-owner-1',
        effects: false,
        throwInfrastructure: true,
      })
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.folders.create',
          actor: createWorkspaceApiKeyPrincipal(),
        }),
      })
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledOnce()
  })
})
