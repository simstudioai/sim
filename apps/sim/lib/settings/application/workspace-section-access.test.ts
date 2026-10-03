import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  customBlockOperationsMock,
  customBlockOperationsMockFns,
} from '@sim/testing/mocks/custom-block-operations.mock'
import {
  createMockDeploymentShape,
  deploymentShapeMock,
  deploymentShapeMockFns,
} from '@sim/testing/mocks/deployment-shape.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceForkingAuthzMock,
  workspaceForkingAuthzMockFns,
} from '@sim/testing/mocks/workspace-forking-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  canOpenOrganizationSettingsSection: vi.fn(),
  getOrganizationSettingsFeatures: vi.fn((hasEnterprisePlan: boolean) => ({ hasEnterprisePlan })),
  isOrganizationSettingsSectionAvailable: vi.fn(),
  isPlatformAdmin: vi.fn(),
  isAccessRequestEnabled: vi.fn(),
  resolveWorkspaceNavigation: vi.fn(),
}))

vi.mock('@/components/settings/navigation', () => ({
  getOrganizationSettingsFeatures: hoisted.getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable: hoisted.isOrganizationSettingsSectionAvailable,
  resolveWorkspaceNavigation: hoisted.resolveWorkspaceNavigation,
  UNIFIED_TO_ORGANIZATION_SECTION: {
    organization: 'members',
    billing: 'billing',
    'connected-accounts': 'connected-accounts',
    'access-control': 'access-control',
  },
  UNIFIED_TO_WORKSPACE_SECTION: {
    requests: 'requests',
    secrets: 'secrets',
    forks: 'forks',
    'custom-blocks': 'custom-blocks',
  },
  workspaceSectionUsesPermissionConfig: vi.fn((section: string) =>
    ['secrets', 'api-keys', 'inbox', 'mcp', 'custom-tools'].includes(section)
  ),
  WORKSPACE_PERMISSION_CONFIG_KEYS: { secrets: 'hideSecretsTab' },
}))
vi.mock('@/ee/access-requests/lib/settings', () => ({
  isAccessRequestEnabled: hoisted.isAccessRequestEnabled,
}))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: hoisted.canOpenOrganizationSettingsSection,
}))
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: hoisted.isPlatformAdmin }))
vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)

import { authorizeWorkspaceSettingsSection } from '@/lib/settings/application/workspace-section-access'

const mocks = {
  ...hoisted,
  isCustomBlocksEligibleForOrganization:
    customBlockOperationsMockFns.mockIsCustomBlocksEligibleForOrganization,
  isForkingAvailableForWorkspace: workspaceForkingAuthzMockFns.mockIsForkingAvailableForWorkspace,
  isScopedCredentialGroupsAvailable:
    credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  deploymentShape: createMockDeploymentShape({
    hosted: true,
    billingEnabled: true,
    features: { inbox: false, sessionPolicies: false, whitelabeling: false },
  }),
  checkWorkspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
  isOrganizationOnEnterprisePlan: billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan,
  isKnowledgeMemberAccessAvailable:
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable,
  resolveVerifiedUserAccessControlContext:
    permissionGroupsResolveMockFns.mockResolveVerifiedUserAccessControlContext,
}

deploymentShapeMockFns.mockGetDeploymentShape.mockReturnValue(mocks.deploymentShape)

/** Access Control follows the regime; these tests drive it from the same plan knob. */
permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive.mockImplementation(
  (organizationId: string) => mocks.isOrganizationOnEnterprisePlan(organizationId)
)

const PERSONAL_ACCESS = {
  exists: true,
  hasAccess: true,
  permission: 'admin',
  workspace: {
    id: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'owner-1',
  },
}

const ORGANIZATION_ACCESS = {
  ...PERSONAL_ACCESS,
  workspace: {
    ...PERSONAL_ACCESS.workspace,
    organizationId: 'organization-1',
  },
}

function authorize(section: Parameters<typeof authorizeWorkspaceSettingsSection>[0]['section']) {
  return authorizeWorkspaceSettingsSection({
    workspaceId: 'workspace-1',
    userId: 'viewer-1',
    section,
  })
}

describe('authorizeWorkspaceSettingsSection', () => {
  beforeEach(() => {
    mocks.deploymentShape.billingEnabled = true
    mocks.checkWorkspaceAccess.mockResolvedValue(PERSONAL_ACCESS)
    mocks.isCustomBlocksEligibleForOrganization.mockResolvedValue(true)
    mocks.isForkingAvailableForWorkspace.mockResolvedValue(true)
    mocks.isOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mocks.isOrganizationSettingsSectionAvailable.mockReturnValue(true)
    mocks.isScopedCredentialGroupsAvailable.mockResolvedValue(true)
    mocks.isKnowledgeMemberAccessAvailable.mockResolvedValue(false)
    mocks.isPlatformAdmin.mockResolvedValue(true)
    mocks.isAccessRequestEnabled.mockResolvedValue(false)
    mocks.canOpenOrganizationSettingsSection.mockResolvedValue(true)
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({ config: {} })
    mocks.resolveWorkspaceNavigation.mockReturnValue([{ id: 'secrets' }])
  })

  it('conceals missing and inaccessible workspaces before section-specific reads', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      permission: null,
      workspace: PERSONAL_ACCESS.workspace,
    })

    await expect(authorize('billing')).resolves.toEqual({
      allowed: false,
      disposition: 'not-found',
    })
    expect(mocks.canOpenOrganizationSettingsSection).not.toHaveBeenCalled()
  })

  it('conceals platform sections from non-platform admins', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false)

    await expect(authorize('admin')).resolves.toEqual({
      allowed: false,
      disposition: 'not-found',
    })
    expect(mocks.isPlatformAdmin).toHaveBeenCalledWith('viewer-1')
  })

  it('keeps deployment and role exclusions when considering a permission request', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      config: { hideSecretsTab: true },
    })
    mocks.resolveWorkspaceNavigation.mockReturnValue([])
    mocks.isAccessRequestEnabled.mockResolvedValue(true)

    await expect(authorize('secrets')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
    expect(mocks.isAccessRequestEnabled).not.toHaveBeenCalled()
  })

  it('enforces canonical permission config independently of billing subscription state', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      entitled: true,
      config: { hideSecretsTab: true },
    })
    mocks.resolveWorkspaceNavigation.mockReturnValue([])

    await expect(authorize('secrets')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
  })

  it('allows personal billing only to the billed account owner', async () => {
    await expect(authorize('billing')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })

    mocks.checkWorkspaceAccess.mockResolvedValue({
      ...PERSONAL_ACCESS,
      workspace: { ...PERSONAL_ACCESS.workspace, billedAccountUserId: 'viewer-1' },
    })
    await expect(authorize('billing')).resolves.toEqual({ allowed: true })
    expect(mocks.canOpenOrganizationSettingsSection).not.toHaveBeenCalled()
  })

  it('requires current organization membership for the roster with billing disabled', async () => {
    mocks.deploymentShape.billingEnabled = false
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.canOpenOrganizationSettingsSection.mockResolvedValue(false)

    await expect(authorize('organization')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
  })

  it.each([
    { groups: true, search: false, allowed: true },
    { groups: false, search: false, allowed: false },
    { groups: true, search: true, allowed: true },
    { groups: false, search: true, allowed: false },
  ])(
    'gates Credential Groups with organization groups=$groups and search=$search',
    async ({ groups, search, allowed }) => {
      mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
      mocks.isScopedCredentialGroupsAvailable.mockResolvedValue(groups)
      mocks.isKnowledgeMemberAccessAvailable.mockResolvedValue(search)

      await expect(authorize('connected-accounts')).resolves.toEqual(
        allowed ? { allowed: true } : { allowed: false, disposition: 'redirect-general' }
      )
      expect(mocks.canOpenOrganizationSettingsSection).toHaveBeenCalledWith(
        'organization-1',
        'viewer-1',
        'connected-accounts'
      )
      expect(mocks.isScopedCredentialGroupsAvailable).toHaveBeenCalledWith({
        kind: 'organization',
        organizationId: 'organization-1',
      })
      expect(mocks.isKnowledgeMemberAccessAvailable).not.toHaveBeenCalled()
      expect(mocks.isOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
    }
  )

  it('does not infer organization admin access from workspace admin access', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.canOpenOrganizationSettingsSection.mockResolvedValue(false)

    await expect(authorize('connected-accounts')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
    expect(mocks.isScopedCredentialGroupsAvailable).not.toHaveBeenCalled()
  })

  it('requires current organization access and plan availability for enterprise sections', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.canOpenOrganizationSettingsSection.mockResolvedValue(false)

    await expect(authorize('access-control')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
    expect(mocks.canOpenOrganizationSettingsSection).toHaveBeenCalledWith(
      'organization-1',
      'viewer-1',
      'access-control'
    )
    expect(mocks.isOrganizationOnEnterprisePlan).toHaveBeenCalledWith('organization-1')
  })
})
