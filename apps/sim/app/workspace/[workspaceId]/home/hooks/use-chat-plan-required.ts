'use client'

import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-context'

/**
 * Whether this workspace's payer may not use Chat, so sends that run admission would refuse are
 * held and answered with the Chat plan modal instead.
 *
 * The verdict is the host context's `features.chat`, which the server resolves with the same
 * check admission runs. A surface without a workspace host (an organization conversation), or a
 * context that predates the flag, is not held here; admission still answers it with the card.
 */
export function useChatPlanRequired(): boolean {
  return useOptionalWorkspaceHostContext()?.features?.chat === false
}
