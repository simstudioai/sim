'use client'

import { useEffect, useRef } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components'
import {
  getMothershipUseChatOptions,
  useChat,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'

interface LiveChatProps {
  /** A workspace id, or the organization for an org-wide chat. */
  owner: string | { organizationId: string }
  /** Existing chat to load; omit to start a new one on the first message. */
  chatId?: string
  /** Sent once when the chat starts without an id: the message handed over from the home composer. */
  initialMessage?: string
  onInitialMessageSent?: () => void
  /** A new chat got its id from the server. */
  onChatCreated?: (chatId: string) => void
  layout: 'mothership-view' | 'copilot-view'
  className?: string
}

/** The real Sim Chat over the shared streaming hook; the surface around it owns the URL. */
export function LiveChat({
  owner,
  chatId,
  initialMessage,
  onInitialMessageSent,
  onChatCreated,
  layout,
  className,
}: LiveChatProps) {
  const { data: session } = useSession()
  const {
    messages,
    isChatHistoryPending,
    isSending,
    isReconnecting,
    sendMessage,
    stopGeneration,
    resolvedChatId,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    cancelQueueEdit,
    editingQueuedId,
    dispatchingHeadId,
  } = useChat(
    owner,
    chatId,
    getMothershipUseChatOptions({ requestMode: 'agent', syncChatUrl: false })
  )

  const sentInitialRef = useRef(false)
  useEffect(() => {
    if (!initialMessage || chatId || sentInitialRef.current) return
    sentInitialRef.current = true
    void sendMessage(initialMessage)
    onInitialMessageSent?.()
  }, [initialMessage, chatId, sendMessage, onInitialMessageSent])

  const announcedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resolvedChatId || chatId || announcedRef.current === resolvedChatId) return
    announcedRef.current = resolvedChatId
    onChatCreated?.(resolvedChatId)
  }, [resolvedChatId, chatId, onChatCreated])

  const ownerKey = typeof owner === 'string' ? owner : `org:${owner.organizationId}`

  return (
    <MothershipChat
      className={className}
      workspaceId={typeof owner === 'string' ? owner : undefined}
      messages={messages}
      isSending={isSending}
      isReconnecting={isReconnecting}
      isLoading={Boolean(chatId) && messages.length === 0 && isChatHistoryPending}
      onSubmit={(text, fileAttachments, contexts) =>
        void sendMessage(text, fileAttachments, contexts)
      }
      onStopGeneration={() => void stopGeneration()}
      messageQueue={messageQueue}
      editingQueuedId={editingQueuedId}
      dispatchingHeadId={dispatchingHeadId}
      onRemoveQueuedMessage={removeFromQueue}
      onSendQueuedMessage={sendNow}
      onEditQueuedMessage={editQueuedMessage}
      onCancelQueueEdit={cancelQueueEdit}
      userId={session?.user?.id}
      chatId={resolvedChatId}
      draftScopeKey={`proto:${ownerKey}:${chatId ?? 'new'}`}
      layout={layout}
    />
  )
}
