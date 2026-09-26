import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { events } = vi.hoisted(() => ({
  events: [] as string[],
}))

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'

const mockNotify = realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged

const mockAudit = auditMockFns.mockRecordAudit

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const mockAssertItems = workspaceUploadsMockFns.mockAssertWorkspaceFileItemsBelongToWorkspace
const mockLoadContext = workspaceUploadsMockFns.mockLoadWorkspaceFileOperationContext
const mockMove = workspaceUploadsMockFns.mockMoveWorkspaceFileItems

describe('moveWorkspaceFileItemsOperation', () => {
  beforeEach(() => {
    events.length = 0
    mockLoadContext.mockImplementation(async () => {
      events.push('resolve')
      return {
        workspaceId: 'ws-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'owner-1',
      }
    })
    mockResolvePermission.mockImplementation(async () => {
      events.push('authorize')
      return 'write'
    })
    mockAssertItems.mockImplementation(async () => {
      events.push('execute')
    })
    mockMove.mockImplementation(async () => ({
      movedFiles: 2,
      movedFolders: 1,
      movedFileIds: ['file-1', 'file-2'],
      movedFolderIds: ['folder-1'],
    }))
  })

  it('allows authorization to carry a resource ID only for one explicit file', async () => {
    mockMove.mockResolvedValue({
      movedFiles: 1,
      movedFolders: 0,
      movedFileIds: ['file-1'],
      movedFolderIds: [],
    })

    await moveWorkspaceFileItemsOperation.execute({
      principal: createDelegatedPrincipal({
        workspaceId: 'ws-1',
        audience: 'sim:workspace-files',
        resourceScope: { fileId: 'file-1' },
      }),
      input: { workspaceId: 'ws-1', fileIds: ['file-1'], targetFolderId: null },
    })

    expect(mockResolvePermission).toHaveBeenCalledOnce()
  })

  it('does not audit or notify requested IDs absent from the mutation result', async () => {
    mockMove.mockResolvedValue({
      movedFiles: 0,
      movedFolders: 0,
      movedFileIds: [],
      movedFolderIds: [],
    })

    const result = await moveWorkspaceFileItemsOperation.execute({
      principal: createSessionPrincipal(),
      input: { workspaceId: 'ws-1', fileIds: ['file-1'], targetFolderId: null },
    })

    expect(result).toMatchObject({ movedItems: { files: 0, folders: 0 } })
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('authorizes before rejecting an empty selection without touching storage', async () => {
    await expect(
      moveWorkspaceFileItemsOperation.execute({
        principal: createSessionPrincipal(),
        input: { workspaceId: 'ws-1' },
      })
    ).rejects.toThrow('At least one file or folder must be selected')
    expect(events).toEqual(['resolve', 'authorize'])
    expect(mockMove).not.toHaveBeenCalled()
  })
})
