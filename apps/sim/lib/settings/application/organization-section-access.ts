import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
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
  if (section === 'search-mcp' || section === 'integrations')
    return isKnowledgeMemberAccessAvailable({ organizationId })

  const deployment = getDeploymentShape()
  const needsEnterprisePlan = deployment.hosted && section !== 'members' && section !== 'billing'
  const hasEnterprisePlan = needsEnterprisePlan
    ? await isOrganizationOnEnterprisePlan(organizationId)
    : false

  return isOrganizationSettingsSectionAvailable(
    section,
    getOrganizationSettingsFeatures(hasEnterprisePlan, deployment)
  )
}
