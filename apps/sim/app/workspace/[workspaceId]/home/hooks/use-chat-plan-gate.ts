'use client'

import { useCallback } from 'react'
import { toast } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { CHAT_PLAN_REQUIRED_MESSAGE } from '@/lib/billing/chat-plan'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/**
 * Stops a send from a workspace whose payer may not use Chat before it starts a turn that run
 * admission would refuse. A member who can manage the workspace's billing goes to its upgrade
 * page; anyone else is told who can upgrade. The returned callback reports whether the send was
 * stopped.
 *
 * The verdict is the host context's `features.chat`, which the server resolves with the same
 * check admission runs. A surface without a workspace host (an organization conversation), or a
 * context that predates the flag, is not stopped here; admission still answers it with the
 * upgrade card.
 */
export function useChatPlanGate(): () => boolean {
  const hostContext = useOptionalWorkspaceHostContext()
  const { data: session } = useSession()
  const viewerId = session?.user?.id
  const router = useRouter()

  return useCallback(() => {
    if (!hostContext || hostContext.features?.chat !== false) return false

    if (canManageWorkspaceBilling(hostContext, viewerId)) {
      router.push(buildUpgradeHref(hostContext.workspace.id))
    } else {
      toast.error(
        hostContext.hostOrganizationId
          ? `${CHAT_PLAN_REQUIRED_MESSAGE} Contact an organization admin to upgrade this workspace’s plan.`
          : `${CHAT_PLAN_REQUIRED_MESSAGE} Ask the workspace owner to upgrade this workspace’s plan.`
      )
    }
    return true
  }, [hostContext, viewerId, router])
}
