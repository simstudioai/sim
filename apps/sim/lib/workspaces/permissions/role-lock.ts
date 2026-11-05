export type WorkspaceRoleSource = 'owner' | 'explicit' | 'org-admin'

/**
 * Explanation shown when a workspace member's role is fixed and cannot be
 * edited. Returns null for editable roles.
 *
 * Mirrors the server guards on `PATCH /api/workspaces/[id]/permissions`, which
 * refuse the same three cases — so every reason here must have a guard there and
 * vice versa, or the UI offers a control that can only fail.
 */
export function workspaceRoleLockReason(
  roleSource: WorkspaceRoleSource | undefined,
  options?: { isBilledAccount?: boolean }
): string | null {
  if (roleSource === 'org-admin') return 'Organization admins are automatically workspace admins'
  if (roleSource === 'owner') return 'Workspace owner'
  if (options?.isBilledAccount) return 'Workspace billing account'
  return null
}
