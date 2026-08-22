/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getDetail: vi.fn(),
  listMembers: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspaces/public-queries', () => ({
  getPublicWorkspaceDetail: mocks.getDetail,
  queryPublicWorkspaceMembers: mocks.listMembers,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getPublicWorkspace } from '@/lib/workspaces/application/get-public-workspace'
import { listPublicWorkspaceMembers } from '@/lib/workspaces/application/list-public-workspace-members'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}

describe('public workspace application reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        principal: {
          kind: 'personal_api_key',
          userId: 'user-1',
          keyId: 'key-1',
        },
        input: { workspaceId: 'workspace-1', limit: 50 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listMembers).not.toHaveBeenCalled()
  })

  it('returns not-found for an inactive canonical workspace', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      getPublicWorkspace.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.getDetail).not.toHaveBeenCalled()
  })

  it('propagates canonical workspace load failures', async () => {
    const failure = new Error('database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      getPublicWorkspace.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)
  })
})
