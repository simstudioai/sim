/** Role assignable to a member of a shared resource (credential, skill). */
export type MemberRole = 'member' | 'admin'

export interface MemberRoleOption {
  value: MemberRole
  label: string
}

/**
 * Roles assignable to a resource member. Shared by every member-management
 * surface (credential detail, skill members) so role choices never drift.
 */
export const MEMBER_ROLE_OPTIONS: readonly MemberRoleOption[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const
