/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  create: vi.fn(),
  relocate: vi.fn(),
  delete: vi.fn(),
  loadIndex: vi.fn(),
  listRows: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    FOLDER_CREATED: 'folder.created',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
  },
  AuditResourceType: { FOLDER: 'folder' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPathTransition: mocks.create,
  deleteFolderByPathTransition: mocks.delete,
  relocateFolderByPathTransition: mocks.relocate,
}))
vi.mock('@/lib/folders/queries', () => ({
  listActiveFolderRows: mocks.listRows,
  loadActiveFolderPathIndex: mocks.loadIndex,
  resolveFolderPathFromIndex: (index: { idByPath: Map<string, string> }, path: string) =>
    path === '/' ? null : index.idByPath.get(path),
}))

import {
  createWorkflowFolder,
  deleteWorkflowFolder,
  listWorkflowFolders,
} from '@/lib/workflows/application/workflow-folders'

const folder = {
  id: 'folder-1',
  resourceType: 'workflow' as const,
  name: 'Reports',
  userId: 'owner-1',
  workspaceId: 'ws-1',
  parentId: null,
  sortOrder: 0,
  locked: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
}
const index = {
  rowById: new Map([[folder.id, folder]]),
  pathById: new Map([[folder.id, '/Reports']]),
  idByPath: new Map([['/Reports', folder.id]]),
}

const principals: Principal[] = [
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  { kind: 'personal_api_key', userId: 'user-1', keyId: 'personal-1' },
  { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'workspace-1' },
  {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'ws-1',
    delegationId: 'delegation-1',
    audience: 'sim:workflows',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  },
]

describe('workflow folder application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue({
      workspaceId: 'ws-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.loadIndex.mockResolvedValue(index)
    mocks.create.mockResolvedValue({ success: true, folder, path: '/Reports' })
    mocks.delete.mockResolvedValue({
      success: true,
      folderId: folder.id,
      folderName: folder.name,
      path: '/Reports',
      deletedItems: { folders: 1, workflows: 2 },
    })
  })

  it.each(principals.map((principal) => [principal.kind, principal] as const))(
    'allows the %s principal through canonical workspace authorization',
    async (_kind, principal) => {
      await createWorkflowFolder.execute({
        principal,
        input: { workspaceId: 'ws-1', path: '/Reports' },
      })

      expect(mocks.create).toHaveBeenCalledWith({
        resourceType: 'workflow',
        workspaceId: 'ws-1',
        userId: principal.kind === 'workspace_api_key' ? 'owner-1' : 'user-1',
        path: '/Reports',
        maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
      })
      expect(mocks.recordAudit).toHaveBeenCalledOnce()
    }
  )

  it('bounds both the path index and listed folder rows', async () => {
    mocks.listRows.mockResolvedValueOnce([folder])

    await listWorkflowFolders.execute({
      principal: principals[0],
      input: { workspaceId: 'ws-1', sortBy: 'name', sortOrder: 'asc' },
    })

    expect(mocks.loadIndex).toHaveBeenCalledWith('ws-1', 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    expect(mocks.listRows).toHaveBeenCalledWith(
      'ws-1',
      'workflow',
      expect.objectContaining({ maxRows: MAX_FOLDERS_PER_WORKSPACE })
    )
  })

  it('rejects a workspace key outside the canonical workspace before mutation', async () => {
    await expect(
      createWorkflowFolder.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'ws-2', keyId: 'workspace-2' },
        input: { workspaceId: 'ws-1', path: '/Reports' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('keeps workspace-key audit attribution non-human', async () => {
    await deleteWorkflowFolder.execute({
      principal: { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'workspace-1' },
      input: { workspaceId: 'ws-1', path: '/Reports', recursive: true },
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          actor: {
            kind: 'workspace_api_key',
            keyId: 'workspace-1',
            workspaceId: 'ws-1',
          },
        }),
      })
    )
  })

  it('does not audit a rejected transition', async () => {
    mocks.create.mockResolvedValue({
      success: false,
      error: 'Folder is locked',
      errorCode: 'locked',
    })

    await expect(
      createWorkflowFolder.execute({
        principal: principals[0],
        input: { workspaceId: 'ws-1', path: '/Reports' },
      })
    ).rejects.toMatchObject({ code: 'locked' })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates context infrastructure failures without mutation or audit', async () => {
    const failure = new Error('database unavailable')
    mocks.resolveContext.mockRejectedValueOnce(failure)

    await expect(
      listWorkflowFolders.execute({
        principal: principals[0],
        input: {
          workspaceId: 'ws-1',
          sortBy: 'name',
          sortOrder: 'asc',
        },
      })
    ).rejects.toBe(failure)
    expect(mocks.listRows).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
