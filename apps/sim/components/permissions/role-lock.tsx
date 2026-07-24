'use client'

import type { ReactNode } from 'react'
import { Tooltip } from '@sim/emcn'

export type WorkspaceRoleSource = 'owner' | 'explicit' | 'org-admin'
export type CredentialRoleSource = 'explicit' | 'workspace-admin'

/**
 * Explanation shown when a workspace member's role is fixed by inheritance and
 * cannot be edited. Returns null for editable (`explicit`) roles.
 */
export function workspaceRoleLockReason(
  roleSource: WorkspaceRoleSource | undefined
): string | null {
  if (roleSource === 'org-admin') return 'Organization admins are automatically workspace admins'
  if (roleSource === 'owner') return 'Workspace owner'
  return null
}

/**
 * Explanation shown when a credential member's role is fixed because they are a
 * workspace admin. Returns null for editable (`explicit`) roles.
 */
export function credentialRoleLockReason(
  roleSource: CredentialRoleSource | undefined
): string | null {
  if (roleSource === 'workspace-admin') {
    return 'Workspace admins are automatically credential admins'
  }
  return null
}

/**
 * Explanation shown when a skill editor's access is inherited from their
 * workspace admin role rather than an explicit grant, and so cannot be removed.
 * Returns null for explicitly added editors.
 */
export function skillEditorLockReason(isWorkspaceAdmin: boolean): string | null {
  return isWorkspaceAdmin ? 'Workspace admins are automatically skill editors' : null
}

interface RoleLockTooltipProps {
  reason: string | null
  children: ReactNode
}

/**
 * Wraps a disabled role control in a tooltip explaining why the role is fixed.
 * Renders children unchanged when there is no lock reason.
 */
export function RoleLockTooltip({ reason, children }: RoleLockTooltipProps) {
  if (!reason) return <>{children}</>

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className='inline-flex'>{children}</div>
      </Tooltip.Trigger>
      <Tooltip.Content>{reason}</Tooltip.Content>
    </Tooltip.Root>
  )
}
