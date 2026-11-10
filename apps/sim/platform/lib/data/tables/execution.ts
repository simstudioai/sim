'use client'

import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useChatHandoff } from '@/platform/lib/data/chat-handoff'
import type { ChatContext } from '@/stores/panel'

/**
 * Whether the viewer's permission group lets them read a run's trace, input and output, as the
 * legacy log details decide it. `pending` until the policy settles, so nothing shows and then hides;
 * a failed read shows them, as the legacy default does.
 */
export function useTraceVisibility(workspaceId: string): 'pending' | 'shown' | 'hidden' {
  const policy = useUserPermissionConfig(workspaceId)
  if (policy.isPending) return 'pending'
  return policy.data?.config?.hideTraceSpans ? 'hidden' : 'shown'
}

interface TroubleshootTarget {
  workspaceId: string
  executionId: string
  workflowName: string | null
}

/**
 * Hands a failed run to a new chat tagged with its execution, as the legacy log details do: the
 * message is stored for the organization's chat surface, which sends it as it mounts. Available
 * only where the viewer can start an agent chat.
 */
export function useTroubleshootRun() {
  const chat = useChatHandoff()
  return {
    available: chat.available,
    troubleshoot({ workspaceId, executionId, workflowName }: TroubleshootTarget) {
      const context: ChatContext = {
        kind: 'logs',
        executionId,
        label: workflowName ?? 'this run',
        workspaceId,
      }
      const message = workflowName
        ? `The "${workflowName}" workflow run failed. Investigate the error in this run and help me fix it.`
        : 'This workflow run failed. Investigate the error in this run and help me fix it.'
      chat.handOff({ message, contexts: [context], requestMode: 'agent' })
    },
  }
}
