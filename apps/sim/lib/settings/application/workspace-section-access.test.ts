/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canOpenOrganizationSettingsSection: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  deploymentShape: {
    hosted: true,
    billingEnabled: true,
    chatEnabled: true,
    azureConfigured: false,
    cohereConfigured: false,
    features: {
      accessControl: false,
      auditLogs: false,
      customBlocks: false,
      dataDrains: false,
      dataRetention: false,
      inbox: false,
      sandboxes: false,
      sessionPolicies: false,
      sso: false,
      usageMonitoring: false,
      whitelabeling: false,
    },
  },
  getOrganizationSettingsFeatures: vi.fn((hasEnterprisePlan: boolean) => ({ hasEnterprisePlan })),
  isCustomBlocksEligibleForOrganization: vi.fn(),
  isForkingAvailableForWorkspace: vi.fn(),
  isOrganizationOnEnterprisePlan: vi.fn(),
  isOrganizationSettingsSectionAvailable: vi.fn(),
  isScopedCredentialGroupsAvailable: vi.fn(),
  isKnowledgeMemberAccessAvailable: vi.fn(),
  isPlatformAdmin: vi.fn(),
  isAccessRequestEnabled: vi.fn(),
  resolveVerifiedUserAccessControlContext: vi.fn(),
  resolveWorkspaceNavigation: vi.fn(),
}))

vi.mock('@/components/settings/navigation', () => ({
  getOrganizationSettingsFeatures: mocks.getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable: mocks.isOrganizationSettingsSectionAvailable,
  resolveWorkspaceNavigation: mocks.resolveWorkspaceNavigation,
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
  isAccessRequestEnabled: mocks.isAccessRequestEnabled,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.isOrganizationOnEnterprisePlan,
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  getDeploymentShape: () => mocks.deploymentShape,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.isScopedCredentialGroupsAvailable,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mocks.isKnowledgeMemberAccessAvailable,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  /** Access Control follows the regime; these tests drive it from the same plan knob. */
  isOrganizationPermissionRegimeActive: mocks.isOrganizationOnEnterprisePlan,
}))
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: mocks.canOpenOrganizationSettingsSection,
}))
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }))
vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  isCustomBlocksEligibleForOrganization: mocks.isCustomBlocksEligibleForOrganization,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  resolveVerifiedUserAccessControlContext: mocks.resolveVerifiedUserAccessControlContext,
}))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  isForkingAvailableForWorkspace: mocks.isForkingAvailableForWorkspace,
}))

import { authorizeWorkspaceSettingsSection } from '@/lib/settings/application/workspace-section-access'

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
    vi.clearAllMocks()
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

  it('opens ordinary sections from workspace access alone', async () => {
    await expect(authorize('general')).resolves.toEqual({ allowed: true })

    expect(mocks.canOpenOrganizationSettingsSection).not.toHaveBeenCalled()
    expect(mocks.resolveVerifiedUserAccessControlContext).not.toHaveBeenCalled()
    expect(mocks.isPlatformAdmin).not.toHaveBeenCalled()
  })

  it('conceals platform sections from non-platform admins', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false)

    await expect(authorize('admin')).resolves.toEqual({
      allowed: false,
      disposition: 'not-found',
    })
    expect(mocks.isPlatformAdmin).toHaveBeenCalledWith('viewer-1')
  })

  it('loads canonical access-control policy for affected organization sections', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      config: { hideSecretsTab: true },
    })
    mocks.resolveWorkspaceNavigation.mockReturnValue([])

    await expect(authorize('secrets')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
    expect(mocks.resolveVerifiedUserAccessControlContext).toHaveBeenCalledWith(
      'viewer-1',
      'workspace-1',
      'organization-1'
    )
    expect(mocks.resolveWorkspaceNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ permissionConfig: { hideSecretsTab: true } })
    )
  })

  it('resolves environment access-control policy for the same section in a personal workspace', async () => {
    await authorize('secrets')

    expect(mocks.resolveVerifiedUserAccessControlContext).toHaveBeenCalledWith(
      'viewer-1',
      'workspace-1',
      null
    )
  })

  it.each([true, false])(
    'offers a request-only page when requests are enabled=%s',
    async (enabled) => {
      mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
      mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
        config: { hideSecretsTab: true },
      })
      mocks.resolveWorkspaceNavigation.mockImplementation(({ permissionConfig }) =>
        permissionConfig.hideSecretsTab ? [] : [{ id: 'secrets' }]
      )
      mocks.isAccessRequestEnabled.mockResolvedValue(enabled)

      await expect(authorize('secrets')).resolves.toEqual(
        enabled
          ? { allowed: false, disposition: 'request-access', configKey: 'hideSecretsTab' }
          : { allowed: false, disposition: 'redirect-general' }
      )
      expect(mocks.isAccessRequestEnabled).toHaveBeenCalledWith('organization-1')
    }
  )

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

  it('does not offer organization requests for personal workspace restrictions', async () => {
    mocks.resolveVerifiedUserAccessControlContext.mockResolvedValue({
      config: { hideSecretsTab: true },
    })
    mocks.resolveWorkspaceNavigation.mockImplementation(({ permissionConfig }) =>
      permissionConfig.hideSecretsTab ? [] : [{ id: 'secrets' }]
    )
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

  it('passes the server-resolved deployment shape to both navigation gates', async () => {
    await authorize('secrets')
    expect(mocks.resolveWorkspaceNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: mocks.deploymentShape,
        entitlements: expect.objectContaining({ inbox: true }),
      })
    )

    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    await expect(authorize('access-control')).resolves.toEqual({ allowed: true })
    /**
     * Access Control is gated on the permission regime rather than the plan, so the plan lookup is
     * skipped for it and the regime is what reaches the navigation gate.
     */
    expect(mocks.getOrganizationSettingsFeatures).toHaveBeenCalledWith(
      false,
      mocks.deploymentShape,
      true
    )
  })

  /**
   * The workspace-scoped page reads the same regime as the organization one: an organization whose
   * restrictions still apply during a failing payment must not have this page taken away.
   */
  it('keeps the workspace Access Control page open while the organization is governed', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.isOrganizationOnEnterprisePlan.mockResolvedValue(false)

    await expect(authorize('access-control')).resolves.toEqual({ allowed: true })
    expect(mocks.isOrganizationOnEnterprisePlan).toHaveBeenCalledTimes(1)
  })

  it('opens own requests for workspace members without organization administration or Enterprise entitlement', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.resolveWorkspaceNavigation.mockReturnValue([{ id: 'requests' }])
    mocks.canOpenOrganizationSettingsSection.mockResolvedValue(false)
    await expect(authorize('requests')).resolves.toEqual({ allowed: true })
    expect(mocks.canOpenOrganizationSettingsSection).not.toHaveBeenCalled()
    expect(mocks.isOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('does not offer request settings in a personal workspace', async () => {
    await expect(authorize('requests')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
  })

  it('resolves the exact entitlement source only for gated workspace sections', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(PERSONAL_ACCESS)
    mocks.resolveWorkspaceNavigation.mockReturnValue([{ id: 'forks' }])
    await authorize('forks')
    expect(mocks.isForkingAvailableForWorkspace).toHaveBeenCalledWith(null, 'viewer-1')

    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.resolveWorkspaceNavigation.mockReturnValue([{ id: 'custom-blocks' }])
    await authorize('custom-blocks')
    expect(mocks.isCustomBlocksEligibleForOrganization).toHaveBeenCalledWith('organization-1')
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

  it('allows the member roster with billing disabled while keeping billing unavailable', async () => {
    mocks.deploymentShape.billingEnabled = false
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)

    await expect(authorize('organization')).resolves.toEqual({ allowed: true })
    expect(mocks.canOpenOrganizationSettingsSection).toHaveBeenCalledWith(
      'organization-1',
      'viewer-1',
      'members'
    )
    await expect(authorize('billing')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
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

  it('requires a host organization for Connected accounts', async () => {
    await expect(authorize('connected-accounts')).resolves.toEqual({
      allowed: false,
      disposition: 'redirect-general',
    })
    expect(mocks.canOpenOrganizationSettingsSection).not.toHaveBeenCalled()
  })

  it('propagates feature lookup failures instead of opening Credential Groups', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue(ORGANIZATION_ACCESS)
    mocks.isScopedCredentialGroupsAvailable.mockRejectedValue(new Error('Feature lookup failed'))

    await expect(authorize('connected-accounts')).rejects.toThrow('Feature lookup failed')
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
