import {
  createDelegatedPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getAccountBillingSnapshot: vi.fn(),
  getWorkspaceHostContextForViewer: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/billing/core/account-billing-snapshot', () => ({
  getAccountBillingSnapshot: hoisted.getAccountBillingSnapshot,
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: hoisted.getWorkspaceHostContextForViewer,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { readAccountBilling } from '@/lib/platform-context/application/read-account-billing'
import { readEnterpriseContext } from '@/lib/platform-context/application/read-enterprise-context'

const mocks = {
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  resolveVerifiedUserAccessControlContext:
    permissionGroupsResolveMockFns.mockResolveVerifiedUserAccessControlContext,
}

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}

function copilotPrincipal() {
  return createDelegatedPrincipal({ audience: 'sim:platform-context' })
}

describe('platform context application use cases', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('read')
  })

  it('authorizes a current Copilot subject before reading account billing', async () => {
    const snapshot = {
      plan: 'pro',
      billingScope: 'user',
      organizationId: null,
      usage: {},
      credits: {},
    }
    mocks.getAccountBillingSnapshot.mockResolvedValue(snapshot)

    await expect(
      readAccountBilling.execute({
        principal: copilotPrincipal(),
        input: { workspaceId: 'workspace-1' },
      })
    ).resolves.toBe(snapshot)

    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'org-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.getAccountBillingSnapshot).toHaveBeenCalledWith('user-1')
  })

  it.each([
    {
      name: 'workspace API key',
      principal: createWorkspaceApiKeyPrincipal(),
    },
    {
      name: 'executor delegation',
      principal: { ...copilotPrincipal(), serviceId: 'executor' as const },
    },
  ])('rejects a $name before loading protected account context', async ({ principal }) => {
    await expect(
      readAccountBilling.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.getAccountBillingSnapshot).not.toHaveBeenCalled()
  })

  it('does not load enterprise context when current workspace access is absent', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      readEnterpriseContext.execute({
        principal: copilotPrincipal(),
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.getWorkspaceHostContextForViewer).not.toHaveBeenCalled()
    expect(mocks.resolveVerifiedUserAccessControlContext).not.toHaveBeenCalled()
  })

  it('projects enterprise context only after authorization', async () => {
    mocks.getWorkspaceHostContextForViewer.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        name: 'Customer Support',
        workspaceMode: 'collaborative',
      },
      hostOrganizationId: 'org-1',
      ownerBilling: { plan: 'enterprise', isEnterprise: true },
      viewer: {
        permission: 'admin',
        isHostOrganizationMember: false,
        isHostOrganizationAdmin: false,
        organizationRole: null,
      },
    })
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      entitled: true,
      permissionGroup: null,
      config: DEFAULT_PERMISSION_GROUP_CONFIG,
    })

    await expect(
      readEnterpriseContext.execute({
        principal: copilotPrincipal(),
        input: { workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({
      workspace: {
        id: 'workspace-1',
        capabilities: { canRead: true, canEdit: true, canDeploy: true },
      },
      organization: {
        id: 'org-1',
        relationship: 'external',
        canManageOrganization: false,
      },
      accessControl: { entitled: true },
    })
    expect(mocks.getWorkspaceHostContextForViewer).toHaveBeenCalledWith('workspace-1', 'user-1')
  })

  it('allows read-role execution but hides deployment when every deploy surface is hidden', async () => {
    mocks.getWorkspaceHostContextForViewer.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        name: 'Customer Support',
        workspaceMode: 'collaborative',
      },
      hostOrganizationId: 'org-1',
      ownerBilling: { plan: 'enterprise', isEnterprise: true },
      viewer: {
        permission: 'read',
        isHostOrganizationMember: true,
        isHostOrganizationAdmin: false,
        organizationRole: 'member',
      },
    })
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      entitled: true,
      permissionGroup: null,
      config: {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideDeployApi: true,
        hideDeployMcp: true,
        hideDeployChatbot: true,
      },
    })

    await expect(
      readEnterpriseContext.execute({
        principal: copilotPrincipal(),
        input: { workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({
      workspace: {
        capabilities: {
          canRead: true,
          canEdit: false,
          canRun: true,
          canDeploy: false,
          canManageWorkspace: false,
        },
      },
    })
  })
})
