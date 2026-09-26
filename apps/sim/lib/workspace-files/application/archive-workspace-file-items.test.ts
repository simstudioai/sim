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

import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'

const mockNotify = realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged

const mockAudit = auditMockFns.mockRecordAudit

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const mockAssertItems = workspaceUploadsMockFns.mockAssertWorkspaceFileItemsBelongToWorkspace
const mockArchive = workspaceUploadsMockFns.mockBulkArchiveWorkspaceFileItems
const mockLoadContext = workspaceUploadsMockFns.mockLoadWorkspaceFileOperationContext

describe('archiveWorkspaceFileItemsOperation', () => {
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
    mockArchive.mockImplementation(async () => ({
      files: 1,
      folders: 0,
      fileIds: ['file-1'],
      folderIds: [],
    }))
  })

  it('authorizes a delegated bulk selection without borrowing the first file scope', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: createDelegatedPrincipal({
          workspaceId: 'ws-1',
          audience: 'sim:workspace-files',
          resourceScope: { fileId: 'file-1' },
        }),
        input: { workspaceId: 'ws-1', fileIds: ['file-1', 'file-2'] },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockLoadContext).toHaveBeenCalledWith('ws-1')
    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockAssertItems).not.toHaveBeenCalled()
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('allows a file-scoped delegated principal to archive its one explicit file', async () => {
    const principal = createDelegatedPrincipal({
      workspaceId: 'ws-1',
      audience: 'sim:workspace-files',
      resourceScope: { fileId: 'file-1' },
    })

    await archiveWorkspaceFileItemsOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', fileIds: ['file-1'] },
    })

    expect(mockResolvePermission).toHaveBeenCalledOnce()
  })

  it('denies a file-scoped delegated principal selecting a folder before validation', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: createDelegatedPrincipal({
          workspaceId: 'ws-1',
          audience: 'sim:workspace-files',
          resourceScope: { fileId: 'file-1' },
        }),
        input: { workspaceId: 'ws-1', folderIds: ['folder-1'] },
      })
    ).rejects.toThrow('Delegated workspace access is no longer valid')

    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mockAssertItems).not.toHaveBeenCalled()
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('audits and notifies only authoritative rows returned by the mutation', async () => {
    mockArchive.mockResolvedValue({
      files: 1,
      folders: 1,
      fileIds: ['file-2'],
      folderIds: ['folder-2'],
    })

    const result = await archiveWorkspaceFileItemsOperation.execute({
      principal: createSessionPrincipal(),
      input: {
        workspaceId: 'ws-1',
        fileIds: ['file-1', 'file-2'],
        folderIds: ['folder-1'],
      },
    })

    expect(result).toMatchObject({ deletedItems: { files: 1, folders: 1 } })
    expect(mockAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ metadata: expect.objectContaining({ fileIds: ['file-2'] }) })
    )
    expect(mockAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ metadata: expect.objectContaining({ folderIds: ['folder-2'] }) })
    )
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('rejects oversized selections after authorization and before storage', async () => {
    await expect(
      archiveWorkspaceFileItemsOperation.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'ws-1',
          fileIds: Array.from({ length: 1_001 }, (_, index) => `file-${index}`),
        },
      })
    ).rejects.toThrow('accept at most 1000')
    expect(events).toEqual(['resolve', 'authorize'])
    expect(mockArchive).not.toHaveBeenCalled()
  })
})
