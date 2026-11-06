'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  LiveCredentialCard,
  LiveUsageNotice,
} from '@/platform/app/(shell)/_components/chat/cards/live-credential-card'
import { Conversation } from '@/platform/app/(shell)/_components/chat/conversation/conversation'
import { CHAT_PLACEHOLDERS } from '@/platform/app/(shell)/_components/chat/conversation/model'
import {
  type ChatCards,
  ChatCardsProvider,
} from '@/platform/app/(shell)/_components/chat/message/message-segments'
import { ResourcePanels } from '@/platform/app/(shell)/_components/chat/panel/resource-panels'
import { LiveSearchTab } from '@/platform/app/(shell)/_components/search/live-search-tab'
import { SearchTabProvider } from '@/platform/app/(shell)/_components/search/search-results-host'
import { useLiveChatRuntime } from '@/platform/lib/data/chat'
import { useLiveComposer } from '@/platform/lib/data/chat-composer'
import { usePanelResources } from '@/platform/lib/data/chat-panel'
import { useChatRestore, useViewerId } from '@/platform/lib/data/chat-restore'
import { useOrganization } from '@/platform/lib/data/organization'

const CARDS: ChatCards = { Credential: LiveCredentialCard, Usage: LiveUsageNotice }

const PLACEHOLDERS = {
  agent: CHAT_PLACEHOLDERS,
  assistant: { ...CHAT_PLACEHOLDERS, first: 'Ask about your company’s knowledge…' },
}

interface LiveChatProps {
  chatId?: string
  destination: 'agent' | 'assistant'
  /** A surface's own controls in place of the chat title. */
  header?: ReactNode
  chatPath?: (chatId: string) => string
}

function LiveConversation({ chatId, destination, header, chatPath }: LiveChatProps) {
  const [planning, setPlanning] = useState(false)
  const requestMode = destination === 'agent' && !chatId && planning ? 'plan' : destination
  const { runtime, chat, panel, controller } = useLiveChatRuntime({
    chatId,
    requestMode,
    chatPath,
  })
  const composer = useLiveComposer({
    draftKey:
      chat.resolvedChatId ?? chatId ?? (destination === 'assistant' ? 'search-assistant' : 'home'),
    requestMode,
    chatId: chat.resolvedChatId,
    onPlanChange: destination === 'agent' ? setPlanning : undefined,
  })
  const resources = usePanelResources({ chat, panel, controller })
  return (
    <ChatCardsProvider value={CARDS}>
      <SearchTabProvider value={LiveSearchTab}>
        <ResourcePanels panel={resources}>
          <Conversation
            runtime={runtime}
            composer={composer}
            placeholders={PLACEHOLDERS[destination]}
            header={header}
          />
        </ResourcePanels>
      </SearchTabProvider>
    </ChatCardsProvider>
  )
}

/**
 * The live conversation surface. It waits for the viewer's session, then remounts per viewer,
 * organization, chat and mode, which is how the hook starts each chat clean.
 */
export function LiveChat({ chatId, destination, header, chatPath }: LiveChatProps) {
  const { organization } = useOrganization()
  const userId = useViewerId()
  const restored = useChatRestore(chatId, destination)
  if (restored || !userId) return null
  return (
    <LiveConversation
      key={`${userId}:${organization.id}:${chatId ?? 'new'}:${destination}`}
      chatId={chatId}
      destination={destination}
      header={header}
      chatPath={chatPath}
    />
  )
}
