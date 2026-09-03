import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  resolveWorkspaceNavigation,
  UNIFIED_TO_ORGANIZATION_SECTION,
  UNIFIED_TO_WORKSPACE_SECTION,
  type UnifiedSettingsSection,
  type WorkspaceSettingsSection,
  workspaceSectionUsesPermissionConfig,
} from '@/components/settings/navigation'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { isCustomBlocksEligibleForOrganization } from '@/lib/workflows/custom-blocks/operations'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { resolveVerifiedUserAccessControlContext } from '@/ee/access-control/utils/permission-check'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'

export type WorkspaceSettingsSectionAccess =
  | { allowed: true }
  | { allowed: false; disposition: 'not-found' | 'redirect-general' }

interface AuthorizeWorkspaceSettingsSectionInput {
  workspaceId: string
  userId: string
  section: UnifiedSettingsSection
}

async function canOpenWorkspaceSection(
  section: WorkspaceSettingsSection,
  input: AuthorizeWorkspaceSettingsSectionInput,
  workspace: {
    organizationId: string | null
  },
  permission: NonNullable<Awaited<ReturnType<typeof checkWorkspaceAccess>>['permission']>
): Promise<boolean> {
  const needsOwnerBilling = section === 'credential-groups'
  const ownerBilling = needsOwnerBilling
    ? await getWorkspaceOwnerSubscriptionAccess(input.workspaceId)
    : null

  const [accessControl, credentialGroupsAvailable, forksAvailable, customBlocksAvailable] =
    await Promise.all([
      workspaceSectionUsesPermissionConfig(section)
        ? resolveVerifiedUserAccessControlContext(
            input.userId,
            input.workspaceId,
            workspace.organizationId
          )
        : null,
      section === 'credential-groups' && ownerBilling
        ? isCredentialGroupsAvailable({ workspaceId: input.workspaceId, ownerBilling })
        : false,
      section === 'forks'
        ? isForkingAvailableForWorkspace(workspace.organizationId, input.userId)
        : false,
      section === 'custom-blocks' && workspace.organizationId
        ? isCustomBlocksEligibleForOrganization(workspace.organizationId)
        : false,
    ])

  const deployment = getDeploymentShape()
  const navigation = resolveWorkspaceNavigation({
    permission,
    permissionConfig: accessControl?.config ?? {},
    hosted: deployment.hosted,
    entitlements: {
      byok: deployment.hosted,
      credentialGroups: credentialGroupsAvailable,
      inbox: true,
      customBlocks: customBlocksAvailable,
      forks: forksAvailable,
      sandboxes: true,
    },
  })
  return navigation.some((item) => item.id === section)
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
  if (
    !deployment.billingEnabled &&
    (input.section === 'billing' || input.section === 'organization')
  ) {
    return false
  }
  if (!workspace.organizationId) {
    return input.section === 'billing' && workspace.billedAccountUserId === input.userId
  }

  const needsEnterprisePlan = organizationSection !== 'members' && organizationSection !== 'billing'
  const [canOpenSection, isEnterpriseOrganization] = await Promise.all([
    canOpenOrganizationSettingsSection(workspace.organizationId, input.userId, organizationSection),
    needsEnterprisePlan
      ? isOrganizationOnEnterprisePlan(workspace.organizationId)
      : Promise.resolve(false),
  ])
  return (
    canOpenSection &&
    isOrganizationSettingsSectionAvailable(
      organizationSection,
      getOrganizationSettingsFeatures(needsEnterprisePlan && isEnterpriseOrganization, deployment)
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
  if (
    workspaceSection &&
    !(await canOpenWorkspaceSection(workspaceSection, input, access.workspace, access.permission))
  ) {
    return { allowed: false, disposition: 'redirect-general' }
  }
  if (!(await canOpenOrganizationSection(input, access.workspace))) {
    return { allowed: false, disposition: 'redirect-general' }
  }
  return { allowed: true }
}
