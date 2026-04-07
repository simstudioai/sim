'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { MessageActions } from '@/app/workspace/[workspaceId]/components'
import { ChatMessageAttachments } from '@/app/workspace/[workspaceId]/home/components/chat-message-attachments'
import {
  assistantMessageHasRenderableContent,
  MessageContent,
} from '@/app/workspace/[workspaceId]/home/components/message-content'
import { PendingTagIndicator } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { QueuedMessages } from '@/app/workspace/[workspaceId]/home/components/queued-messages'
import { UserInput } from '@/app/workspace/[workspaceId]/home/components/user-input'
import { UserMessageContent } from '@/app/workspace/[workspaceId]/home/components/user-message-content'
import type {
  ChatMessage,
  FileAttachmentForApi,
  QueuedMessage,
} from '@/app/workspace/[workspaceId]/home/types'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import type { ChatContext } from '@/stores/panel'

interface MothershipChatProps {
  messages: ChatMessage[]
  isSending: boolean
  isReconnecting?: boolean
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => void
  onStopGeneration: () => void
  messageQueue: QueuedMessage[]
  onRemoveQueuedMessage: (id: string) => void
  onSendQueuedMessage: (id: string) => Promise<void>
  onEditQueuedMessage: (id: string) => void
  userId?: string
  chatId?: string
  onContextAdd?: (context: ChatContext) => void
  editValue?: string
  onEditValueConsumed?: () => void
  layout?: 'mothership-view' | 'copilot-view'
  initialScrollBlocked?: boolean
  animateInput?: boolean
  onInputAnimationEnd?: () => void
  className?: string
}

const LAYOUT_STYLES = {
  'mothership-view': {
    scrollContainer:
      'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-8 [scrollbar-gutter:stable_both-edges]',
    content: 'mx-auto max-w-[42rem] space-y-6',
    userRow: 'flex flex-col items-end gap-[6px] pt-3',
    attachmentWidth: 'max-w-[70%]',
    userBubble: 'max-w-[70%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2',
    assistantRow: 'group/msg',
    footer: 'flex-shrink-0 px-[24px] pb-[16px]',
    footerInner: 'mx-auto max-w-[42rem]',
  },
  'copilot-view': {
    scrollContainer: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-4',
    content: 'space-y-4',
    userRow: 'flex flex-col items-end gap-[6px] pt-2',
    attachmentWidth: 'max-w-[85%]',
    userBubble: 'max-w-[85%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3 py-2',
    assistantRow: 'group/msg',
    footer: 'flex-shrink-0 px-3 pb-3',
    footerInner: '',
  },
} as const

export function MothershipChat({
  messages,
  isSending,
  isReconnecting = false,
  onSubmit,
  onStopGeneration,
  messageQueue,
  onRemoveQueuedMessage,
  onSendQueuedMessage,
  onEditQueuedMessage,
  userId,
  chatId,
  onContextAdd,
  editValue,
  onEditValueConsumed,
  layout = 'mothership-view',
  initialScrollBlocked = false,
  animateInput = false,
  onInputAnimationEnd,
  className,
}: MothershipChatProps) {
  const styles = LAYOUT_STYLES[layout]
  const isStreamActive = isSending || isReconnecting
  const { ref: scrollContainerRef, scrollToBottom } = useAutoScroll(isStreamActive, {
    scrollOnMount: true,
  })
  const hasMessages = messages.length > 0
  const initialScrollDoneRef = useRef(false)

  const primedQueueIdRef = useRef<string | null>(null)
  const primeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageQueueRef = useRef(messageQueue)
  messageQueueRef.current = messageQueue
  const onSendQueuedMessageRef = useRef(onSendQueuedMessage)
  onSendQueuedMessageRef.current = onSendQueuedMessage

  const clearPrimed = useCallback(() => {
    primedQueueIdRef.current = null
    if (primeTimerRef.current) {
      clearTimeout(primeTimerRef.current)
      primeTimerRef.current = null
    }
  }, [])

  const handleEnterWhileEmpty = useCallback(() => {
    const topMessage = messageQueueRef.current[0]
    if (!topMessage) return false

    if (primedQueueIdRef.current === topMessage.id) {
      clearPrimed()
      void onSendQueuedMessageRef.current(topMessage.id)
      return true
    }

    primedQueueIdRef.current = topMessage.id
    if (primeTimerRef.current) clearTimeout(primeTimerRef.current)
    primeTimerRef.current = setTimeout(clearPrimed, 3000)
    return true
  }, [clearPrimed])

  useEffect(() => {
    return () => {
      if (primeTimerRef.current) clearTimeout(primeTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (!hasMessages) {
      initialScrollDoneRef.current = false
      return
    }
    if (initialScrollDoneRef.current || initialScrollBlocked) return
    initialScrollDoneRef.current = true
    scrollToBottom()
  }, [hasMessages, initialScrollBlocked, scrollToBottom])

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div ref={scrollContainerRef} className={styles.scrollContainer}>
        <div className={styles.content}>
          {messages.map((msg, index) => {
            if (msg.role === 'user') {
              const hasAttachments = Boolean(msg.attachments?.length)
              return (
                <div key={msg.id} className={styles.userRow}>
                  {hasAttachments && (
                    <ChatMessageAttachments
                      attachments={msg.attachments ?? []}
                      align='end'
                      className={styles.attachmentWidth}
                    />
                  )}
                  <div className={styles.userBubble}>
                    <UserMessageContent content={msg.content} contexts={msg.contexts} />
                  </div>
                </div>
              )
            }

            const hasAnyBlocks = Boolean(msg.contentBlocks?.length)
            const hasRenderableAssistant = assistantMessageHasRenderableContent(
              msg.contentBlocks ?? [],
              msg.content ?? ''
            )
            const isLastAssistant = index === messages.length - 1
            const isThisStreaming = isStreamActive && isLastAssistant

            if (!hasAnyBlocks && !msg.content?.trim() && isThisStreaming) {
              return <PendingTagIndicator key={msg.id} />
            }

            if (!hasRenderableAssistant && !msg.content?.trim() && !isThisStreaming) {
              return null
            }

            const isLastMessage = index === messages.length - 1
            const precedingUserMsg = [...messages]
              .slice(0, index)
              .reverse()
              .find((m) => m.role === 'user')

            return (
              <div key={msg.id} className={styles.assistantRow}>
                <MessageContent
                  blocks={msg.contentBlocks || []}
                  fallbackContent={msg.content}
                  isStreaming={isThisStreaming}
                  onOptionSelect={isLastMessage ? onSubmit : undefined}
                />
                {!isThisStreaming && (msg.content || msg.contentBlocks?.length) && (
                  <div className='mt-2.5'>
                    <MessageActions
                      content={msg.content}
                      chatId={chatId}
                      userQuery={precedingUserMsg?.content}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        className={cn(styles.footer, animateInput && 'animate-slide-in-bottom')}
        onAnimationEnd={animateInput ? onInputAnimationEnd : undefined}
      >
        <div className={styles.footerInner}>
          <QueuedMessages
            messageQueue={messageQueue}
            onRemove={onRemoveQueuedMessage}
            onSendNow={onSendQueuedMessage}
            onEdit={onEditQueuedMessage}
          />
          <UserInput
            onSubmit={onSubmit}
            isSending={isStreamActive}
            onStopGeneration={onStopGeneration}
            isInitialView={false}
            userId={userId}
            onContextAdd={onContextAdd}
            editValue={editValue}
            onEditValueConsumed={onEditValueConsumed}
            onEnterWhileEmpty={handleEnterWhileEmpty}
            onPrimedDismiss={clearPrimed}
          />
        </div>
      </div>
    </div>
  )
}
