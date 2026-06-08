import { CHAT_CONTEXT_KIND_REGISTRY } from '@/app/workspace/[workspaceId]/home/components/chat-context-kind-registry'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

interface ContextMentionIconProps {
  context: ChatMessageContext
  /** Applied to every icon element. Include sizing and positional classes (e.g. h-[12px] w-[12px]). */
  className: string
}

/** Renders the icon for a context mention chip. Returns null when no icon applies. */
export function ContextMentionIcon({ context, className }: ContextMentionIconProps) {
  return (
    CHAT_CONTEXT_KIND_REGISTRY[context.kind].renderIcon({
      context,
      className,
    }) ?? null
  )
}
