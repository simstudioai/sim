/**
 * Helper functions for organization-related computations
 * These are pure functions that compute values from organization data
 */

import type { Organization } from '@/lib/organization/types'

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
  return role === 'owner' || role === 'admin'
}

/**
 * Calculate seat usage for an organization
 */
export function calculateSeatUsage(organization: Organization | null | undefined): {
  used: number
  members: number
  pending: number
} {
  if (!organization) {
    return { used: 0, members: 0, pending: 0 }
  }

  const membersCount = organization.members?.length || 0
  const pendingInvitationsCount =
    organization.invitations?.filter((inv) => inv.status === 'pending').length || 0

  return {
    used: membersCount + pendingInvitationsCount,
    members: membersCount,
    pending: pendingInvitationsCount,
  }
}

/**
 * Get used seats from an organization
 * Alias for calculateSeatUsage for backward compatibility
 */
export function getUsedSeats(organization: Organization | null | undefined) {
  return calculateSeatUsage(organization)
}
