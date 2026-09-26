import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  foldersOrchestrationMock,
  foldersOrchestrationMockFns,
} from '@sim/testing/mocks/folders-orchestration.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)
vi.mock('@/lib/folders/queries', () => folderQueriesMock)

import {
  archivableWorkflowFolderPath,
  createWorkflowFolder,
  deleteWorkflowFolder,
  listWorkflowFolders,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'

const mocks = {
  loadIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  listRows: folderQueriesMockFns.mockListActiveFolderRows,
}

const {
  mockCreateFolderAtPathTransition,
  mockDeleteFolderByPathTransition,
  mockRelocateFolderByPathTransition,
} = foldersOrchestrationMockFns

const mockResolveContext = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockRecordAudit = auditMockFns.mockRecordAudit

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
  createSessionPrincipal(),
  createPersonalApiKeyPrincipal({ keyId: 'personal-1' }),
  createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-1', keyId: 'workspace-1' }),
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
    mockResolveContext.mockResolvedValue({
      workspaceId: 'ws-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    mockResolvePermission.mockResolvedValue('write')
    mocks.loadIndex.mockResolvedValue(index)
    mockCreateFolderAtPathTransition.mockResolvedValue({ success: true, folder, path: '/Reports' })
    mockDeleteFolderByPathTransition.mockResolvedValue({
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

      expect(mockCreateFolderAtPathTransition).toHaveBeenCalledWith({
        resourceType: 'workflow',
        workspaceId: 'ws-1',
        userId: principal.kind === 'workspace_api_key' ? 'owner-1' : 'user-1',
        path: '/Reports',
        maxFolderRows: MAX_FOLDERS_PER_WORKSPACE,
      })
      expect(mockRecordAudit).toHaveBeenCalledOnce()
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
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-2', keyId: 'workspace-2' }),
        input: { workspaceId: 'ws-1', path: '/Reports' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mockCreateFolderAtPathTransition).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('keeps workspace-key audit attribution non-human', async () => {
    await deleteWorkflowFolder.execute({
      principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-1', keyId: 'workspace-1' }),
      input: { workspaceId: 'ws-1', path: '/Reports', recursive: true },
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          actor: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-1', workspaceId: 'ws-1' }),
        }),
      })
    )
  })
})

/**
 * Archiving a folder cascades onto the workflows inside it but leaves their
 * `folderId` pointing at the inactive row, and the folder index holds active
 * folders only. `scope=archived` selects exactly that population, so the strict
 * projector would throw a bare `Error` — an unclassified 500 that takes the
 * whole page down with no cursor position able to step past the row.
 */
describe('folder path projection for archived workflows', () => {
  const archivedFolderId = 'folder-archived'

  it('throws on a dangling folder when the workflow is expected to be active', () => {
    expect(() => workflowFolderPathForId(index, archivedFolderId)).toThrow()
  })

  it('answers the root path instead, which is where restore would place it', () => {
    expect(archivableWorkflowFolderPath(index, archivedFolderId)).toBe('/')
  })
})
