'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn-legacy'
import hostBridge from '@sim/emcn-platform/styles/host-bridge.module.css'
import { AssistantActionReviewProvider } from '@/components/assistant-actions'
import { ChatResourcePanel } from '@/components/mothership-chat/chat-resource-panel'
import {
  type ChatChrome,
  ChatChromeProvider,
} from '@/components/mothership-chat/chat-surface-context'
import { SearchIntegrationConnection } from '@/components/mothership-chat/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/components/mothership-chat/mothership-chat'
import type { ChatRequestMode } from '@/lib/mothership/chat/types'
import type { OrganizationSummaryRequest } from '@/lib/organizations/search-params'
import {
  useConversationGate,
  useOrganizationConversation,
} from '@/app/_organization-conversation/use-organization-conversation'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'
import { PageContextDialog } from '@/platform/embedded/app/(shell)/_components/conversation/dialogs'
import { PageComposer } from '@/platform/embedded/app/(shell)/_components/conversation/page-composer'
import { ResponseActions } from '@/platform/embedded/app/(shell)/_components/conversation/response-actions'
import { ShareDialog } from '@/platform/embedded/app/(shell)/_components/conversation/share-dialog'
import {
  ComposerPlaceholder,
  ConversationSkeleton,
  TranscriptPlaceholder,
} from '@/platform/embedded/app/(shell)/_components/conversation/skeletons'
import { usePageConversationEffects } from '@/platform/embedded/app/(shell)/_components/conversation/use-page-conversation-effects'

const PAGE_CHAT_CHROME: ChatChrome = {
  fontClassName: styles.font,
  panelClassName: styles.panel,
  tabsClassName: cn(styles.tabs, styles.font),
  sourcesClassName: cn(hostBridge.palette, styles.font),
  userBubbleClassName: styles.userBubble,
  responseActionsClassName: styles.responseActions,
  sourcesPopoverClassName: hostBridge.tokens,
  loadingTranscript: <TranscriptPlaceholder />,
  loadingComposer: <ComposerPlaceholder />,
  ResponseActionsComponent: ResponseActions,
  PageContextDialogComponent: PageContextDialog,
  ShareDialogComponent: ShareDialog,
}

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
  draftSlot?: string
  /** Shown until the conversation can mount. */
  fallback: ReactNode
  /** Shown until the first turn takes over. A saved chat has no first view. */
  landing?: (slot: ConversationLandingSlot) => ReactNode
}

/** The shared conversation at every organization destination. */
export function PageConversation(props: PageConversationProps) {
  const gate = useConversationGate(props)
  if (gate.status === 'denied') return null
  if (gate.status === 'restoring') return <ConversationSkeleton header={props.header} />
  if (gate.status === 'waiting') return props.fallback
  return (
    <PageConversationContent
      key={`${gate.instanceKey}:${props.requestMode}`}
      chatId={props.chatId}
      requestMode={props.requestMode}
      header={props.header}
      chatHeader={props.chatHeader}
      active={props.active}
      summaryRequest={props.summaryRequest}
      onSummaryConsumed={props.onSummaryConsumed}
      draftSlot={props.draftSlot}
      fallback={props.fallback}
      landing={props.landing}
    />
  )
}

function PageConversationContent({
  chatId,
  requestMode: destinationMode,
  header: frameHeader,
  chatHeader,
  active,
  summaryRequest,
  onSummaryConsumed,
  draftSlot,
  landing,
}: PageConversationProps) {
  const conversation = useOrganizationConversation({
    surface: { kind: 'page', draftSlot },
    chatId,
    requestMode: destinationMode,
    active,
    summaryRequest,
    onSummaryConsumed,
  })
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
  } = conversation
  usePageConversationEffects({ chatId, requestMode, conversation })
  const header = frameHeader ?? (hasChat ? chatHeader : undefined)
  const composer = <PageComposer {...composerProps} />
  return (
    <ChatChromeProvider value={PAGE_CHAT_CHROME}>
      <ChatResourcePanel
        header={header}
        hideToggleUntilResource={!allowBuildControls || !hasChat}
        allowBuildControls={allowBuildControls}
        organizationId={organization.id}
        chat={chat}
        panel={panel}
        onSummarize={(message, filters) => send(message, undefined, undefined, filters)}
      >
        {hasChat ? (
          // The landing names its own main region; a chat has only this frame to carry it.
          <main className={styles.conversationFrame}>
            <AssistantActionReviewProvider
              organizationId={reviewProps.organizationId}
              chatId={reviewProps.chatId}
              messages={reviewProps.messages}
              active={reviewProps.active}
              enabled={reviewProps.enabled}
            >
              <MothershipChat
                {...threadProps}
                className={cn(hostBridge.palette, styles.thread)}
                reserveResourceHeader={!header && threadProps.reserveResourceHeader}
                SearchConnectionComponent={SearchIntegrationConnection}
                composer={composer}
                initialScrollBlocked={panel.initialScrollBlocked}
              />
            </AssistantActionReviewProvider>
          </main>
        ) : (
          <div className={styles.conversationFrame}>{landing?.({ requestMode, composer })}</div>
        )}
      </ChatResourcePanel>
    </ChatChromeProvider>
  )
}
