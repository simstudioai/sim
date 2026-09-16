/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedCopilotPrincipal } from '@/lib/copilot/auth/application-delegation'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  loadIndex: vi.fn(),
  listRows: vi.fn(),
  createAtPath: vi.fn(),
  relocateByPath: vi.fn(),
  deleteByPath: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    FOLDER_CREATED: 'folder.created',
    FOLDER_MOVED: 'folder.moved',
    FOLDER_DELETED: 'folder.deleted',
  },
  AuditResourceType: { FOLDER: 'folder' },
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

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadIndex,
  listActiveFolderRows: mocks.listRows,
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
  resolveFolderPathFromIndex: (index: { idByPath: Map<string, string> }, path: string) =>
    path === '/' ? null : index.idByPath.get(path),
}))

vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPath: mocks.createAtPath,
  relocateFolderByPath: mocks.relocateByPath,
  deleteFolderByPath: mocks.deleteByPath,
}))

import {
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  listKnowledgeFolders,
} from '@/lib/knowledge/application/folders'

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
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.loadIndex.mockResolvedValue({
      idByPath: new Map([['/Docs', 'folder-1']]),
      pathById: new Map([['folder-1', '/Docs']]),
      rowById: new Map([['folder-1', folder]]),
    })
    mocks.listRows.mockResolvedValue([folder])
    mocks.createAtPath.mockResolvedValue({ success: true, folder, path: '/Docs' })
    mocks.deleteByPath.mockResolvedValue({
      success: true,
      path: '/Docs',
      deletedItems: { folders: 2, knowledgeBases: 3 },
    })
  })

  it('resolves a canonical parent path before listing', async () => {
    const result = await listKnowledgeFolders.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', parentPath: '/Docs' },
    })

    expect(mocks.listRows).toHaveBeenCalledWith(
      'workspace-1',
      'knowledge_base',
      expect.objectContaining({ parentId: 'folder-1' })
    )
    expect(result.folders[0]).toMatchObject({ id: 'folder-1', path: '/Docs' })
  })

  it('allows a current workspace reader to resolve folders through Copilot', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    const result = await listKnowledgeFolders.execute({
      principal: createTrustedCopilotPrincipal(
        { userId: 'user-1', workspaceId: 'workspace-1', delegationId: 'chat-1' },
        { audience: 'sim:knowledge', ttlMs: 60_000 }
      ),
      input: { workspaceId: 'workspace-1' },
    })
    expect(result.folders).toEqual([{ ...folder, path: '/Docs' }])
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'other-workspace'])(
    'rejects %s Copilot access before listing folders',
    async (reason) => {
      if (reason === 'revoked') mocks.resolvePermission.mockResolvedValue(null)
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

  /**
   * `parentPath` is a filter, so a path naming no active folder narrows the
   * result to nothing rather than reporting the collection missing. Falling
   * through to `listActiveFolderRows` with an undefined `parentId` would list
   * every folder in the workspace, so the miss has to short-circuit.
   */
  it('answers a parent path naming no folder with an empty page', async () => {
    const result = await listKnowledgeFolders.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', parentPath: '/Missing' },
    })

    expect(result.folders).toEqual([])
    expect(mocks.listRows).not.toHaveBeenCalled()
  })

  it('uses compatibility attribution only for storage and key attribution for audit', async () => {
    await createKnowledgeFolder.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
      input: { workspaceId: 'workspace-1', path: '/Docs', source: 'v2' },
    })

    expect(mocks.createAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'knowledge_base',
        userId: 'billing-owner-1',
        effects: false,
        throwInfrastructure: true,
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.folders.create',
          actor: {
            kind: 'workspace_api_key',
            keyId: 'key-1',
            workspaceId: 'workspace-1',
          },
        }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('preserves recursive cascade counts', async () => {
    const result = await deleteKnowledgeFolder.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', path: '/Docs', recursive: true },
    })

    expect(mocks.deleteByPath).toHaveBeenCalledWith(
      expect.objectContaining({ recursive: true, effects: false, throwInfrastructure: true })
    )
    expect(result.deletedItems).toEqual({ folders: 2, knowledgeBases: 3 })
  })

  it('propagates infrastructure failures without audit', async () => {
    const failure = new Error('folder database unavailable')
    mocks.createAtPath.mockRejectedValueOnce(failure)

    await expect(
      createKnowledgeFolder.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', path: '/Docs' },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
