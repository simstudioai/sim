import { cache } from 'react'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import {
  type OrganizationSettingsSection,
  resolveOrganizationSectionAccess,
} from '@/components/settings/navigation'

interface OrganizationSettingsAccess {
  isAdmin: boolean
  isMember: boolean
  role: string | null
}

/**
 * Resolves settings authority from membership in the organization named by the
 * route. Session active-organization state is intentionally not consulted.
 */
async function resolveOrganizationSettingsAccess(
  organizationId: string,
  userId: string
): Promise<OrganizationSettingsAccess> {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  const role = membership?.role ?? null
  return {
    role,
    isMember: role !== null,
    isAdmin: isOrgAdminRole(role),
  }
}

/**
 * Request-memoized organization authority for nested Server Components.
 * Non-React callers execute the resolver normally without cross-request state.
 */
export const getOrganizationSettingsAccess = cache(resolveOrganizationSettingsAccess)

/**
 * Checks whether a route-derived organization member may open a section.
 */
export async function canOpenOrganizationSettingsSection(
  organizationId: string,
  userId: string,
  section: OrganizationSettingsSection
): Promise<boolean> {
  const access = await getOrganizationSettingsAccess(organizationId, userId)
  return (
    resolveOrganizationSectionAccess({
      section,
      isTargetOrganizationMember: access.isMember,
      isTargetOrganizationAdmin: access.isAdmin,
    }) !== 'unavailable'
  )
}
