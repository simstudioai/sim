import type { MessagePhase } from '@/app/workspace/[workspaceId]/home/components/message-content'

interface AssistantMessageActionsVisibility {
  phase: MessagePhase
  hasContent: boolean
  endsWithQuestion: boolean
  questionDismissed: boolean
}

/**
 * Question cards replace the normal message actions while they are active or
 * answered. Dismissing an active card restores those actions for the settled
 * assistant message underneath it.
 */
export function shouldShowAssistantMessageActions({
  phase,
  hasContent,
  endsWithQuestion,
  questionDismissed,
}: AssistantMessageActionsVisibility): boolean {
  return phase === 'settled' && hasContent && (!endsWithQuestion || questionDismissed)
}
