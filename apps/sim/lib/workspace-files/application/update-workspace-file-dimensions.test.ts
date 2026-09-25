import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

import { updateWorkspaceFileDimensionsOperation } from '@/lib/workspace-files/application/update-workspace-file-dimensions'

const mocks = {
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  updateDimensions: workspaceFileManagerMockFns.mockUpdateWorkspaceFileDimensions,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

describe('updateWorkspaceFileDimensionsOperation', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue({
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.updateDimensions.mockResolvedValue(false)
  })

  it('preserves a stale-key write as a successful false result', async () => {
    const result = await updateWorkspaceFileDimensionsOperation.execute({
      principal: createSessionPrincipal(),
      input: {
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-1',
        key: 'workspace/workspace-1/current-key',
        width: 800,
        height: 600,
      },
    })

    expect(result).toEqual({ success: false })
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', { includeDeleted: undefined })
    expect(mocks.updateDimensions).toHaveBeenCalledWith('workspace-1', 'file-1', {
      key: 'workspace/workspace-1/current-key',
      width: 800,
      height: 600,
    })
  })
})
