import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  resolveWorkspaceNavigation,
  UNIFIED_TO_ORGANIZATION_SECTION,
  UNIFIED_TO_WORKSPACE_SECTION,
  type UnifiedSettingsSection,
  WORKSPACE_PERMISSION_CONFIG_KEYS,
  type WorkspaceSettingsSection,
  workspaceSectionUsesPermissionConfig,
} from '@/components/settings/navigation'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { isCustomBlocksEligibleForOrganization } from '@/lib/workflows/custom-blocks/operations'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { resolveVerifiedUserAccessControlContext } from '@/ee/access-control/utils/permission-check'
import { isAccessRequestEnabled } from '@/ee/access-requests/lib/settings'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'

export type WorkspaceSettingsSectionAccess =
  | { allowed: true }
  | { allowed: false; disposition: 'not-found' | 'redirect-general' }
  | { allowed: false; disposition: 'request-access'; configKey: BooleanPermissionGroupConfigKey }

interface AuthorizeWorkspaceSettingsSectionInput {
  workspaceId: string
  userId: string
  section: UnifiedSettingsSection
}

async function authorizeWorkspaceSection(
  section: WorkspaceSettingsSection,
  input: AuthorizeWorkspaceSettingsSectionInput,
  workspace: {
    organizationId: string | null
  },
  permission: NonNullable<Awaited<ReturnType<typeof checkWorkspaceAccess>>['permission']>
): Promise<WorkspaceSettingsSectionAccess> {
  if (section === 'requests' && !workspace.organizationId) {
    return { allowed: false, disposition: 'redirect-general' }
  }
  const [accessControl, forksAvailable, customBlocksAvailable] = await Promise.all([
    workspaceSectionUsesPermissionConfig(section)
      ? resolveVerifiedUserAccessControlContext(
          input.userId,
          input.workspaceId,
          workspace.organizationId
        )
      : null,
    section === 'forks'
      ? isForkingAvailableForWorkspace(workspace.organizationId, input.userId)
      : false,
    section === 'custom-blocks' && workspace.organizationId
      ? isCustomBlocksEligibleForOrganization(workspace.organizationId)
      : false,
  ])

  const deployment = getDeploymentShape()
  const navigationOptions = {
    permission,
    permissionConfig: accessControl?.config ?? {},
    deployment,
    entitlements: {
      inbox: true,
      customBlocks: customBlocksAvailable,
      forks: forksAvailable,
      sandboxes: true,
    },
  }
  if (resolveWorkspaceNavigation(navigationOptions).some((item) => item.id === section)) {
    return { allowed: true }
  }

  const configKey = WORKSPACE_PERMISSION_CONFIG_KEYS[section]
  if (
    configKey &&
    accessControl?.config?.[configKey] &&
    workspace.organizationId &&
    resolveWorkspaceNavigation({
      ...navigationOptions,
      permissionConfig: { ...navigationOptions.permissionConfig, [configKey]: false },
    }).some((item) => item.id === section) &&
    (await isAccessRequestEnabled(workspace.organizationId))
  ) {
    return { allowed: false, disposition: 'request-access', configKey }
  }
  return { allowed: false, disposition: 'redirect-general' }
}

async function canOpenOrganizationSection(
  input: AuthorizeWorkspaceSettingsSectionInput,
  workspace: {
    organizationId: string | null
    billedAccountUserId: string
  }
): Promise<boolean> {
  const organizationSection = UNIFIED_TO_ORGANIZATION_SECTION[input.section]
  if (!organizationSection) return true
  const deployment = getDeploymentShape()
  if (!deployment.billingEnabled && input.section === 'billing') {
    return false
  }
  if (!workspace.organizationId) {
    return input.section === 'billing' && workspace.billedAccountUserId === input.userId
  }

  if (organizationSection === 'connected-accounts') {
    return authorizeOrganizationSettingsSection({
      organizationId: workspace.organizationId,
      userId: input.userId,
      section: organizationSection,
    })
  }

  const needsEnterprisePlan =
    organizationSection !== 'members' &&
    organizationSection !== 'billing' &&
    organizationSection !== 'requests'
  const readsRegime = needsEnterprisePlan && organizationSection === 'access-control'
  const [canOpenSection, isEnterpriseOrganization, governanceActive] = await Promise.all([
    canOpenOrganizationSettingsSection(workspace.organizationId, input.userId, organizationSection),
    needsEnterprisePlan && !readsRegime
      ? isOrganizationOnEnterprisePlan(workspace.organizationId)
      : Promise.resolve(false),
    readsRegime
      ? isOrganizationPermissionRegimeActive(workspace.organizationId)
      : Promise.resolve(false),
  ])
  return (
    canOpenSection &&
    isOrganizationSettingsSectionAvailable(
      organizationSection,
      getOrganizationSettingsFeatures(
        needsEnterprisePlan && isEnterpriseOrganization,
        deployment,
        governanceActive
      )
    )
  )
}

export async function authorizeWorkspaceSettingsSection(
  input: AuthorizeWorkspaceSettingsSectionInput
): Promise<WorkspaceSettingsSectionAccess> {
  const requiresPlatformAdmin = input.section === 'admin' || input.section === 'mothership'
  const [access, viewerIsPlatformAdmin] = await Promise.all([
    checkWorkspaceAccess(input.workspaceId, input.userId),
    requiresPlatformAdmin ? isPlatformAdmin(input.userId) : Promise.resolve(false),
  ])
  if (!access.exists || !access.hasAccess || !access.workspace || !access.permission) {
    return { allowed: false, disposition: 'not-found' }
  }
  if (requiresPlatformAdmin && !viewerIsPlatformAdmin) {
    return { allowed: false, disposition: 'not-found' }
  }

  const workspaceSection = UNIFIED_TO_WORKSPACE_SECTION[input.section]
  if (workspaceSection) {
    const sectionAccess = await authorizeWorkspaceSection(
      workspaceSection,
      input,
      access.workspace,
      access.permission
    )
    if (!sectionAccess.allowed) return sectionAccess
  }
  if (!(await canOpenOrganizationSection(input, access.workspace))) {
    return { allowed: false, disposition: 'redirect-general' }
  }
  return { allowed: true }
}
