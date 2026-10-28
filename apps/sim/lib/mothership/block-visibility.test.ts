import {
  blockVisibilityMock,
  blockVisibilityMockFns,
} from '@sim/testing/mocks/block-visibility.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { getBlockVisibilityForCopilot } from '@/lib/mothership/block-visibility'

const mocks = {
  visibility: blockVisibilityMockFns.mockGetBlockVisibility,
  workspace: permissionsMockFns.mockGetWorkspaceWithOwner,
}

describe('organization catalog visibility', () => {
  it('keeps organization gates distinct without selecting or querying a workspace', async () => {
    mocks.visibility.mockImplementation(async ({ orgId }) => ({
      revealed: new Set([orgId]),
      disabled: new Set(),
      previewTagged: new Set(),
    }))
    const first = await getBlockVisibilityForCopilot('org-viewer', undefined, 'organization-a')
    const second = await getBlockVisibilityForCopilot('org-viewer', undefined, 'organization-b')
    expect(first.revealed).toEqual(new Set(['organization-a']))
    expect(second.revealed).toEqual(new Set(['organization-b']))
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.visibility).toHaveBeenCalledTimes(2)
  })
  it('preserves canonical workspace organization instead of accepting a conflicting hint', async () => {
    mocks.workspace.mockResolvedValue({ organizationId: 'actual-organization' })
    await getBlockVisibilityForCopilot('workspace-viewer', 'workspace', 'untrusted-hint')
    expect(mocks.visibility).toHaveBeenLastCalledWith({
      userId: 'workspace-viewer',
      orgId: 'actual-organization',
    })
  })
})
