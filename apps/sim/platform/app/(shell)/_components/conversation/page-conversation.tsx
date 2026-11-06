'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { AssistantActionReviewProvider } from '@/components/assistant-actions'
import {
  type OrganizationSummaryRequest,
  useConversationGate,
  useOrganizationConversation,
} from '@/app/o/[organizationId]/components/use-organization-conversation'
import { ChatResourcePanel } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { CONVERSATION_APPEARANCE } from '@/platform/app/(shell)/_components/conversation/appearance'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import { PageComposer } from '@/platform/app/(shell)/_components/conversation/page-composer'

/** What a surface's own landing arranges. */
export interface ConversationLandingSlot {
  requestMode: ChatRequestMode
  composer: ReactNode
}

interface PageConversationProps {
  chatId?: string
  requestMode: ChatRequestMode
  header?: ReactNode
  /** Shown over the conversation once the first turn has replaced the landing. */
  chatHeader?: ReactNode
  active?: boolean
  summaryRequest?: OrganizationSummaryRequest
  onSummaryConsumed?: (id: string) => void
  /** Names this surface's new-chat draft, for a surface that must not share another's. */
  draftId?: string
  /** Shown until the conversation can mount. */
  fallback: ReactNode
  /** Shown until the first turn takes over. A saved chat has no first view. */
  landing?: (slot: ConversationLandingSlot) => ReactNode
}

/** The shared conversation at every organization destination. */
export function PageConversation(props: PageConversationProps) {
  const gate = useConversationGate(props)
  if (gate.status === 'denied') return null
  if (gate.status === 'restoring') return <HomeFallback header={props.header} />
  if (gate.status === 'waiting') return props.fallback
  return <PageConversationContent key={`${gate.instanceKey}:${props.requestMode}`} {...props} />
}

function PageConversationContent({
  chatId,
  requestMode: destinationMode,
  header: frameHeader,
  chatHeader,
  active,
  summaryRequest,
  onSummaryConsumed,
  draftId,
  landing,
}: PageConversationProps) {
  const {
    organization,
    chat,
    panel,
    hasChat,
    requestMode,
    allowBuildControls,
    send,
    composerProps,
    threadProps,
    reviewProps,
  } = useOrganizationConversation({
    surface: { kind: 'page', draftId },
    chatId,
    requestMode: destinationMode,
    active,
    summaryRequest,
    onSummaryConsumed,
  })
  const header = frameHeader ?? (hasChat ? chatHeader : undefined)
  const composer = <PageComposer {...composerProps} />
  return (
    <ChatResourcePanel
      appearance={CONVERSATION_APPEARANCE.panel}
      header={header}
      hideToggleUntilResource={!allowBuildControls || !hasChat}
      allowBuildControls={allowBuildControls}
      organizationId={organization.id}
      chat={chat}
      panel={panel}
      onSummarize={(message, filters) => send(message, undefined, undefined, filters)}
    >
      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]',
          'md:min-w-[min(480px,50%)]'
        )}
      >
        {hasChat ? (
          <AssistantActionReviewProvider {...reviewProps}>
            <MothershipChat
              {...threadProps}
              className={`${styles.palette} ${styles.thread}`}
              appearance={CONVERSATION_APPEARANCE.chat}
              reserveResourceHeader={!header && threadProps.reserveResourceHeader}
              SearchConnectionComponent={SearchIntegrationConnection}
              composer={composer}
              initialScrollBlocked={panel.initialScrollBlocked}
            />
          </AssistantActionReviewProvider>
        ) : (
          landing?.({ requestMode, composer })
        )}
      </div>
    </ChatResourcePanel>
  )
}
