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

export type SkillEditorRole = 'editor'

/**
 * Skill membership is binary — a user either edits the skill or does not, and
 * `skill_member` has no role column. The single option keeps the roster's role
 * control identical in shape to the credential surface's while being honest
 * that there is nothing to switch between; every skill row renders it disabled.
 */
export const SKILL_EDITOR_ROLE_OPTIONS: readonly { value: SkillEditorRole; label: string }[] = [
  { value: 'editor', label: 'Editor' },
] as const
