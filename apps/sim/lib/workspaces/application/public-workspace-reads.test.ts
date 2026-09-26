import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getDetail: vi.fn(),
  listMembers: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/public-queries', () => ({
  getPublicWorkspaceDetail: hoisted.getDetail,
  queryPublicWorkspaceMembers: hoisted.listMembers,
}))

vi.mock('@sim/audit', () => auditMock)

import { getPublicWorkspace } from '@/lib/workspaces/application/get-public-workspace'
import { listPublicWorkspaceMembers } from '@/lib/workspaces/application/list-public-workspace-members'

const mocks = {
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  recordAudit: auditMockFns.mockRecordAudit,
}

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const workspacePrincipal = createWorkspaceApiKeyPrincipal()

describe('public workspace application reads', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getDetail.mockResolvedValue({ id: 'workspace-1' })
    mocks.listMembers.mockResolvedValue({ members: [], nextEmail: null })
  })

  it('authorizes workspace keys as the workspace without billing-owner membership', async () => {
    await expect(
      getPublicWorkspace.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ workspace: { id: 'workspace-1' } })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('requires current personal-key workspace permission before member loading', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      listPublicWorkspaceMembers.execute({
        principal: createPersonalApiKeyPrincipal(),
        input: { workspaceId: 'workspace-1', limit: 50 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listMembers).not.toHaveBeenCalled()
  })
})
