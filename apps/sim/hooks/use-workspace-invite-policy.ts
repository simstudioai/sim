'use client'

import { useMemo } from 'react'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export interface UseWorkspaceInvitePolicyReturn {
  /**
   * Why inviting is unavailable, already phrased for whoever is asking — the
   * billed user is told to upgrade, everyone else to contact the owner. `null`
   * when inviting is available, and also when it is blocked by a switch that has
   * no viewer-facing explanation.
   */
  inviteDisabledReason: string | null
  /** Whether inviting is blocked at all, by any of the sources below. */
  isInvitationsDisabled: boolean
}

/**
 * The workspace's invite gate, as every entry point offering an invite or a
 * teammate-management action must read it.
 *
 * Two independent sources say no, and both have to be consulted: the deployment
 * or permission-group switch (`NEXT_PUBLIC_DISABLE_INVITATIONS`, a permission
 * group's `disableInvitations`), which is silent about why, and the workspace's
 * own plan policy, which supplies {@link UseWorkspaceInvitePolicyReturn.inviteDisabledReason}.
 * Reading only one of them is what lets an entry point offer an invite the server
 * then refuses.
 *
 * For callers that are already handed the workspace — the workspace switcher gets
 * the whole list as a prop — deriving the same two fields inline is correct; this
 * hook is for the ones that would otherwise fetch the list just to ask.
 */
export function useWorkspaceInvitePolicy(workspaceId: string): UseWorkspaceInvitePolicyReturn {
  const { isInvitationsDisabled: isInvitationsDisabledByConfig } = usePermissionConfig()
  const { data: workspaces } = useWorkspacesQuery()

  const inviteDisabledReason =
    workspaces?.find((workspace) => workspace.id === workspaceId)?.inviteDisabledReason ?? null

  return useMemo(
    () => ({
      inviteDisabledReason,
      isInvitationsDisabled: isInvitationsDisabledByConfig || inviteDisabledReason !== null,
    }),
    [inviteDisabledReason, isInvitationsDisabledByConfig]
  )
}
