import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isOrganizationCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'

export function isPeopleEnabled(organizationId: string): Promise<boolean> {
  return isFeatureEnabled('people', { orgId: organizationId })
}

export async function requirePeopleEnabled(organizationId: string): Promise<void> {
  if (!(await isPeopleEnabled(organizationId))) {
    throw new OrchestrationError('forbidden', 'People is not enabled for this organization')
  }
}

/**
 * Whether the People page is on for `organizationId` and its directory open to a member with
 * `role`: administrators always see it; other members unless their permission group withholds
 * `organization.member_directory`, the capability its reads enforce.
 */
export async function canBrowsePeople(organizationId: string, role: string): Promise<boolean> {
  if (!(await isPeopleEnabled(organizationId))) return false
  return (
    isOrgAdminRole(role) ||
    !(await isOrganizationCapabilityWithheld(organizationId, 'organization.member_directory'))
  )
}
