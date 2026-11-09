import {
  getOrganizationSettingsFeatures,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { isTeamOrganization } from '@/lib/billing/core/payer-organization'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { isMemorySpacesEnabled } from '@/lib/mothership/feature-flags'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'
import { organizationPlanAllowsSettingsSection } from '@/lib/settings/section-availability'

interface AuthorizeOrganizationSettingsSectionInput {
  organizationId: string
  userId: string
  section: OrganizationSettingsSection
}

/** Reuses the target-organization gate before reading its plan entitlement. */
export async function authorizeOrganizationSettingsSection({
  organizationId,
  userId,
  section,
}: AuthorizeOrganizationSettingsSectionInput): Promise<boolean> {
  if (!(await canOpenOrganizationSettingsSection(organizationId, userId, section))) return false
  const deployment = getDeploymentShape()
  const isTeam = await isTeamOrganization(organizationId)
  if (
    !isTeam &&
    !organizationPlanAllowsSettingsSection(
      section,
      getOrganizationSettingsFeatures(false, deployment, false, true)
    )
  )
    return false

  if (section === 'knowledge-graphs') return isMemorySpacesEnabled(userId)

  if (section === 'connected-accounts') {
    return isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId })
  }
  if (section === 'search-mcp' || section === 'search-slack' || section === 'integrations')
    return isKnowledgeMemberAccessAvailable({ organizationId })

  const needsEnterprisePlan =
    deployment.hosted && section !== 'members' && section !== 'billing' && section !== 'requests'
  /** Access Control follows the permission regime rather than the plan gate. */
  const readsRegime = needsEnterprisePlan && section === 'access-control'
  const [hasEnterprisePlan, governanceActive] = await Promise.all([
    needsEnterprisePlan && !readsRegime
      ? isOrganizationOnEnterprisePlan(organizationId)
      : Promise.resolve(false),
    readsRegime ? isOrganizationPermissionRegimeActive(organizationId) : Promise.resolve(false),
  ])

  return organizationPlanAllowsSettingsSection(
    section,
    getOrganizationSettingsFeatures(hasEnterprisePlan, deployment, governanceActive, !isTeam)
  )
}
