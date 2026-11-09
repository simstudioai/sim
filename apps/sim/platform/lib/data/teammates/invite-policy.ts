'use client'

import { getEnv, isTruthy } from '@/lib/core/config/env'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/**
 * The workspace's invite gate, read from the same two sources as `useWorkspaceInvitePolicy`: the
 * deployment or permission-group switch, which is silent about why, and the workspace's plan
 * policy, which says why. It reads the raw group config, not `usePermissionConfig`, which also
 * projects block availability and would bundle the block registry for one boolean.
 */
export function useWorkspaceInvitePolicy(workspaceId: string) {
  const config = useUserPermissionConfig(workspaceId).data?.config
  const { data: workspaces } = useWorkspacesQuery()
  const inviteDisabledReason =
    workspaces?.find((workspace) => workspace.id === workspaceId)?.inviteDisabledReason ?? null
  return {
    inviteDisabledReason,
    isInvitationsDisabled:
      isTruthy(getEnv('NEXT_PUBLIC_DISABLE_INVITATIONS')) ||
      Boolean(config?.disableInvitations) ||
      inviteDisabledReason !== null,
  }
}
