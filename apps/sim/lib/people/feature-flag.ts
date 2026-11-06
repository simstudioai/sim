import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
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

const logger = createLogger('People')

/**
 * Whether to show the People page to a member with `role`: it is on for `organizationId`, and its
 * directory is open to them — administrators always, other members unless their permission group
 * withholds `organization.member_directory`, the capability its reads enforce. For navigation
 * only, so a lookup that fails hides People rather than failing the page around it.
 */
export async function canBrowsePeople(organizationId: string, role: string): Promise<boolean> {
  try {
    if (!(await isPeopleEnabled(organizationId))) return false
    return (
      isOrgAdminRole(role) ||
      !(await isOrganizationCapabilityWithheld(organizationId, 'organization.member_directory'))
    )
  } catch (error) {
    logger.warn('Could not resolve People navigation access', {
      organizationId,
      error: getErrorMessage(error),
    })
    return false
  }
}
