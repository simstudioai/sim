/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceHostContextForViewer, mockResolveVerifiedUserAccessControlContext } =
  vi.hoisted(() => ({
    mockGetWorkspaceHostContextForViewer: vi.fn(),
    mockResolveVerifiedUserAccessControlContext: vi.fn(),
  }))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  resolveVerifiedUserAccessControlContext: mockResolveVerifiedUserAccessControlContext,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeGetEnterpriseContext } from '@/lib/copilot/tools/handlers/enterprise-context'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/types'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
} as ExecutionContext

function enterpriseHost(permission: 'read' | 'write' | 'admin') {
  return {
    workspace: {
      id: 'workspace-1',
      name: 'Customer Support',
      workspaceMode: 'collaborative',
      billedAccountUserId: 'owner-1',
    },
    hostOrganizationId: 'org-1',
    ownerBilling: {
      plan: 'enterprise',
      status: 'active',
      isPaid: true,
      isPro: true,
      isTeam: true,
      isEnterprise: true,
      isOrgScoped: true,
      organizationId: 'org-1',
      billingInterval: 'year',
      billingBlocked: false,
      billingBlockedReason: null,
    },
    viewer: {
      permission,
      isHostOrganizationMember: false,
      isHostOrganizationAdmin: false,
      organizationRole: null,
    },
  }
}

describe('executeGetEnterpriseContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires a current workspace', async () => {
    const result = await executeGetEnterpriseContext({ userId: 'user-1' } as ExecutionContext)

    expect(result).toEqual({
      success: false,
      error: 'A current workspace is required to resolve enterprise access.',
    })
    expect(mockGetWorkspaceHostContextForViewer).not.toHaveBeenCalled()
  })

  it('keeps external workspace administration separate from organization authority', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(enterpriseHost('admin'))
    mockResolveVerifiedUserAccessControlContext.mockResolvedValue({
      organizationId: 'org-1',
      entitled: true,
      permissionGroup: {
        id: 'group-1',
        name: 'Contractors',
        resolution: 'all-members',
      },
      config: {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        allowedIntegrations: ['slack'],
        deniedTools: ['slack_delete_message'],
        disableMcpTools: true,
        disableInvitations: true,
      },
    })

    const result = await executeGetEnterpriseContext(context)

    expect(mockResolveVerifiedUserAccessControlContext).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'org-1'
    )
    expect(result).toMatchObject({
      success: true,
      output: {
        workspace: {
          id: 'workspace-1',
          permission: 'admin',
          capabilities: {
            canRead: true,
            canEdit: true,
            canRun: true,
            canDeploy: true,
            canManageWorkspace: true,
          },
        },
        organization: {
          id: 'org-1',
          relationship: 'external',
          role: null,
          canManageOrganization: false,
          canManageBilling: false,
          plan: 'enterprise',
          isEnterprise: true,
        },
        accessControl: {
          entitled: true,
          governingPermissionGroup: {
            id: 'group-1',
            name: 'Contractors',
            resolution: 'all-members',
          },
          effectiveConfig: expect.objectContaining({ disableMcpTools: true }),
          activeRestrictions: expect.arrayContaining([
            expect.objectContaining({ key: 'allowedIntegrations' }),
            expect.objectContaining({ key: 'deniedTools' }),
            expect.objectContaining({ key: 'disableMcpTools' }),
            expect.objectContaining({ key: 'disableInvitations' }),
          ]),
        },
      },
    })
  })

  it('reports an internal member role without granting organization administration', async () => {
    const host = enterpriseHost('write')
    mockGetWorkspaceHostContextForViewer.mockResolvedValue({
      ...host,
      viewer: {
        ...host.viewer,
        isHostOrganizationMember: true,
        organizationRole: 'member',
      },
    })
    mockResolveVerifiedUserAccessControlContext.mockResolvedValue({
      organizationId: 'org-1',
      entitled: true,
      permissionGroup: null,
      config: null,
    })

    const result = await executeGetEnterpriseContext(context)

    expect(result).toMatchObject({
      success: true,
      output: {
        workspace: {
          permission: 'write',
          capabilities: {
            canRead: true,
            canEdit: true,
            canRun: true,
            canDeploy: false,
            canManageWorkspace: false,
          },
        },
        organization: {
          relationship: 'internal',
          role: 'member',
          canManageOrganization: false,
          canManageBilling: false,
        },
      },
    })
  })

  it('reports read access without write, run, deployment, or administration capabilities', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(enterpriseHost('read'))
    mockResolveVerifiedUserAccessControlContext.mockResolvedValue({
      organizationId: 'org-1',
      entitled: true,
      permissionGroup: null,
      config: null,
    })

    const result = await executeGetEnterpriseContext(context)

    expect(result).toMatchObject({
      success: true,
      output: {
        workspace: {
          permission: 'read',
          capabilities: {
            canRead: true,
            canEdit: false,
            canRun: false,
            canDeploy: false,
            canManageWorkspace: false,
          },
        },
      },
    })
  })

  it('returns a personal-workspace context without looking up organization membership', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue({
      ...enterpriseHost('write'),
      hostOrganizationId: null,
      ownerBilling: {
        ...enterpriseHost('write').ownerBilling,
        plan: 'pro',
        isEnterprise: false,
        isOrgScoped: false,
        organizationId: null,
      },
    })
    mockResolveVerifiedUserAccessControlContext.mockResolvedValue({
      organizationId: null,
      entitled: false,
      permissionGroup: null,
      config: null,
    })

    const result = await executeGetEnterpriseContext(context)

    expect(result).toMatchObject({
      success: true,
      output: {
        workspace: { permission: 'write' },
        organization: null,
        accessControl: {
          entitled: false,
          governingPermissionGroup: null,
          effectiveConfig: null,
          activeRestrictions: [],
        },
      },
    })
    expect(mockResolveVerifiedUserAccessControlContext).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      null
    )
  })

  it('does not expose enterprise context when workspace access cannot be resolved', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)

    const result = await executeGetEnterpriseContext(context)

    expect(result).toEqual({
      success: false,
      error: 'Workspace not found or you do not have access.',
    })
    expect(mockResolveVerifiedUserAccessControlContext).not.toHaveBeenCalled()
  })

  it('returns a failure when workspace context resolution fails', async () => {
    mockGetWorkspaceHostContextForViewer.mockRejectedValue(new Error('workspace lookup failed'))

    const result = await executeGetEnterpriseContext(context)

    expect(result).toEqual({ success: false, error: 'workspace lookup failed' })
    expect(mockResolveVerifiedUserAccessControlContext).not.toHaveBeenCalled()
  })

  it('returns a failure when access-control resolution fails', async () => {
    mockGetWorkspaceHostContextForViewer.mockResolvedValue(enterpriseHost('write'))
    mockResolveVerifiedUserAccessControlContext.mockRejectedValue(
      new Error('access-control lookup failed')
    )

    const result = await executeGetEnterpriseContext(context)

    expect(result).toEqual({ success: false, error: 'access-control lookup failed' })
  })
})
