/**
 * Utility functions for organization-related operations
 * These are pure functions that compute values from organization data
 */

import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import type { Organization } from '@/lib/workspaces/organization/types'

/**
 * Get the role of a user in an organization
 */
export function getUserRole(
  organization: Organization | null | undefined,
  userEmail?: string
): string {
  if (!userEmail || !organization?.members) {
    return 'member'
  }
  const currentMember = organization.members.find((m) => m.user?.email === userEmail)
  return currentMember?.role ?? 'member'
}

/**
 * Check if a user is an admin or owner in an organization
 */
export function isAdminOrOwner(
  organization: Organization | null | undefined,
  userEmail?: string
): boolean {
  const role = getUserRole(organization, userEmail)
  return isOrgAdminRole(role)
}

/**
 * Generate a URL-friendly slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-') // Replace consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading and trailing hyphens
}
