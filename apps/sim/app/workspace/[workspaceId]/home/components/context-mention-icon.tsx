import { CHAT_CONTEXT_KIND_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/chat-context-kind-registry'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

interface ContextMentionIconProps {
  context: ChatMessageContext
  /** Only used when context.kind is 'workflow' or 'current_workflow'; ignored otherwise. */
  workflowColor?: string | null
  /** Applied to every icon element. Include sizing and positional classes (e.g. h-[12px] w-[12px]). */
  className: string
}

/** Renders the icon for a context mention chip. Returns null when no icon applies. */
export function ContextMentionIcon({ context, workflowColor, className }: ContextMentionIconProps) {
  return (
    CHAT_CONTEXT_KIND_REGISTRY[context.kind].renderIcon({
      context,
      className,
      workflowColor,
    }) ?? null
  )
}
