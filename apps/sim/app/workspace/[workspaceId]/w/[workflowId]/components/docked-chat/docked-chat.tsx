'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components'
import { getMothershipUseChatOptions, useChat } from '@/app/workspace/[workspaceId]/home/hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useMothershipChatHistory } from '@/hooks/queries/mothership-chats'
import { useMothershipStageStore } from '@/stores/mothership-stage/store'
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
 * and any other resource stages on the home surface's single resource panel —
 * the chat carries along via `?chat=`. The conversation itself is the same
 * chat that the chat view hosts — same history, same drafts.
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
  /** Readable from stream callbacks before the hook's return is in scope. */
  const activeChatIdRef = useRef<string | undefined>(chatId)

  /**
   * Stages a non-workflow resource on the home surface's panel and follows it
   * there, keeping the chat open beside it. The panel shows one resource at a
   * time, so there is nothing to stack here.
   */
  const stageOnHome = (resource: MothershipResource) => {
    useMothershipStageStore.getState().setStage(workspaceId, resource)
    const chatKey = activeChatIdRef.current
    router.push(
      chatKey
        ? `/workspace/${workspaceId}/chat/${chatKey}?resource=${resource.id}`
        : `/workspace/${workspaceId}/home?resource=${resource.id}`
    )
  }
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
  } = useChat(
    workspaceId,
    chatId,
    getMothershipUseChatOptions({
      // The stage follows the conversation: another workflow swaps the
      // editor; anything else stages on the home surface's panel.
      onResourceTouched: (resource) => {
        if (resource.type === 'workflow') {
          if (resource.id === workflowId) return
          const chatParam = activeChatIdRef.current
          router.push(
            `/workspace/${workspaceId}/w/${resource.id}${chatParam ? `?chat=${chatParam}` : ''}`
          )
          return
        }
        stageOnHome(resource)
      },
    })
  )

  useEffect(() => {
    if (resolvedChatId && resolvedChatId !== chatId) onChatResolved(resolvedChatId)
  }, [resolvedChatId, chatId, onChatResolved])

  const activeChatId = resolvedChatId ?? chatId
  activeChatIdRef.current = activeChatId
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
    stageOnHome(resource)
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
