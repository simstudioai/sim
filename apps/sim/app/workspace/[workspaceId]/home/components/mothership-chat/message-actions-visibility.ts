import type { MessagePhase } from '@/app/workspace/[workspaceId]/home/components/message-content'

interface AssistantMessageActionsVisibility {
  phase: MessagePhase
  hasContent: boolean
  endsWithInteraction: boolean
  questionDismissed: boolean
}

/**
 * Terminal question and credential cards replace the normal message actions
 * while active or answered. Dismissing a question restores those actions for
 * the settled assistant message underneath it.
 */
export function shouldShowAssistantMessageActions({
  phase,
  hasContent,
  endsWithInteraction,
  questionDismissed,
}: AssistantMessageActionsVisibility): boolean {
  return phase === 'settled' && hasContent && (!endsWithInteraction || questionDismissed)
}
