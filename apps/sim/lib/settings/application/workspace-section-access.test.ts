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
  isPlatformAdmin: vi.fn(),
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
    'access-control': 'access-control',
  },
  UNIFIED_TO_WORKSPACE_SECTION: {
    secrets: 'secrets',
    forks: 'forks',
    'custom-blocks': 'custom-blocks',
  },
  workspaceSectionUsesPermissionConfig: vi.fn((section: string) =>
    ['secrets', 'api-keys', 'inbox', 'mcp', 'custom-tools'].includes(section)
  ),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.isOrganizationOnEnterprisePlan,
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  getDeploymentShape: () => mocks.deploymentShape,
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
    mocks.checkWorkspaceAccess.mockResolvedValue(PERSONAL_ACCESS)
    mocks.isCustomBlocksEligibleForOrganization.mockResolvedValue(true)
    mocks.isForkingAvailableForWorkspace.mockResolvedValue(true)
    mocks.isOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mocks.isOrganizationSettingsSectionAvailable.mockReturnValue(true)
    mocks.isPlatformAdmin.mockResolvedValue(true)
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
    expect(mocks.getOrganizationSettingsFeatures).toHaveBeenCalledWith(true, mocks.deploymentShape)
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
