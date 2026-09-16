import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import {
  isOrganizationGovernanceActive,
  isOrganizationOnEnterprisePlan,
} from '@/lib/billing/core/subscription'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'

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

  if (section === 'connected-accounts') {
    if (!(await isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId })))
      return false
    return !(await isKnowledgeMemberAccessAvailable({ organizationId }))
  }
  if (section === 'search-mcp' || section === 'search-slack' || section === 'integrations')
    return isKnowledgeMemberAccessAvailable({ organizationId })

  const deployment = getDeploymentShape()
  const needsEnterprisePlan = deployment.hosted && section !== 'members' && section !== 'billing'
  /**
   * Access Control is the one section whose availability follows governance rather than the plan
   * gate, and it is the only one that reads it — so the extra lookup is scoped to that section
   * instead of being paid on every settings page.
   */
  const [hasEnterprisePlan, governanceActive] = needsEnterprisePlan
    ? await Promise.all([
        isOrganizationOnEnterprisePlan(organizationId),
        section === 'access-control'
          ? isOrganizationGovernanceActive(organizationId)
          : Promise.resolve(false),
      ])
    : [false, false]

  return isOrganizationSettingsSectionAvailable(
    section,
    getOrganizationSettingsFeatures(hasEnterprisePlan, deployment, governanceActive)
  )
}
