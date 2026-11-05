'use client'

import { OrganizationConversation } from '@/app/o/[organizationId]/components/organization-conversation'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { CONVERSATION_APPEARANCE } from '@/platform/app/(shell)/_components/conversation/appearance'
import { ConversationSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'

interface ChatRouteProps {
  chatId: string
  requestMode: ChatRequestMode
}

/** A saved agent chat. The server page cannot pass the appearance's render functions itself. */
export function ChatRoute(props: ChatRouteProps) {
  return (
    <OrganizationConversation
      {...props}
      appearance={CONVERSATION_APPEARANCE}
      fallback={<ConversationSkeleton />}
    />
  )
}
