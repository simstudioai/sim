'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components'
import { getMothershipUseChatOptions, useChat } from '@/app/workspace/[workspaceId]/home/hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useMothershipChatHistory } from '@/hooks/queries/mothership-chats'
import type { ChatContext } from '@/stores/panel'

interface DockedChatProps {
  workspaceId: string
  /** The workflow occupying the stage — its own chips never navigate. */
  workflowId: string
  /** Undefined renders the new-chat empty state; first send creates the chat. */
  chatId?: string
  onClose: () => void
  /** Swap the docked pane to another chat (host remounts with the new id). */
  onSelectChat: (chatId: string) => void
  /** A new chat resolved its server id — host reflects it into the URL. */
  onChatResolved: (chatId: string) => void
}

/**
 * The Mothership chat docked beside the workflow editor. The editor owns the
 * stage: workflow chips for other workflows swap the stage to their editor,
 * and any other resource chip swaps back to the tabbed chat view with that
 * tab focused. The conversation itself is the same chat that the chat view
 * hosts — same history, same drafts.
 */
export function DockedChat({
  workspaceId,
  workflowId,
  chatId,
  onClose,
  onSelectChat,
  onChatResolved,
}: DockedChatProps) {
  const router = useRouter()
  const {
    messages,
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
  } = useChat(workspaceId, chatId, getMothershipUseChatOptions({}))

  useEffect(() => {
    if (resolvedChatId && resolvedChatId !== chatId) onChatResolved(resolvedChatId)
  }, [resolvedChatId, chatId, onChatResolved])

  const activeChatId = resolvedChatId ?? chatId
  const { isPending: isHistoryPending } = useMothershipChatHistory(activeChatId)
  const showSkeleton = Boolean(activeChatId) && messages.length === 0 && isHistoryPending

  const handleSubmit = (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => {
    const trimmed = text.trim()
    if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
    sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
  }

  const handleWorkspaceResourceSelect = (resource: MothershipResource) => {
    if (resource.type === 'workflow') {
      if (resource.id === workflowId) return
      const chatParam = activeChatId ? `?chat=${activeChatId}` : ''
      router.push(`/workspace/${workspaceId}/w/${resource.id}${chatParam}`)
      return
    }
    if (!activeChatId) return
    router.push(`/workspace/${workspaceId}/chat/${activeChatId}?resource=${resource.id}`)
  }

  return (
    <MothershipChat
      messages={messages}
      isSending={isSending}
      isReconnecting={isReconnecting}
      isLoading={showSkeleton}
      onSubmit={handleSubmit}
      onStopGeneration={() => void stopGeneration().catch(() => {})}
      messageQueue={messageQueue}
      editingQueuedId={editingQueuedId}
      dispatchingHeadId={dispatchingHeadId}
      onRemoveQueuedMessage={removeFromQueue}
      onSendQueuedMessage={sendNow}
      onEditQueuedMessage={editQueuedMessage}
      onCancelQueueEdit={cancelQueueEdit}
      chatId={activeChatId}
      onWorkspaceResourceSelect={handleWorkspaceResourceSelect}
      draftScopeKey={`${workspaceId}:${activeChatId ?? 'new'}`}
      onCloseChat={onClose}
      onSelectChat={onSelectChat}
      switcherNavigates={false}
    />
  )
}
