import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
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

  const deployment = getDeploymentShape()
  const needsEnterprisePlan =
    deployment.hosted && section !== 'members' && section !== 'billing' && section !== 'search-mcp'
  const hasEnterprisePlan = needsEnterprisePlan
    ? await isOrganizationOnEnterprisePlan(organizationId)
    : false

  return isOrganizationSettingsSectionAvailable(
    section,
    getOrganizationSettingsFeatures(hasEnterprisePlan, deployment)
  )
}
