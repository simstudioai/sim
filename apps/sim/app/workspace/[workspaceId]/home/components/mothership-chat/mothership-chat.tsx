'use client'

import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { MessageActions } from '@/app/workspace/[workspaceId]/components'
import { ChatMessageAttachments } from '@/app/workspace/[workspaceId]/home/components/chat-message-attachments'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  assistantMessageHasRenderableContent,
  MessageContent,
  type MessagePhase,
} from '@/app/workspace/[workspaceId]/home/components/message-content'
import { parseQuestionAnswerMessage } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import {
  PendingTagIndicator,
  parseLastQuestionTag,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { QueuedMessages } from '@/app/workspace/[workspaceId]/home/components/queued-messages'
import {
  UserInput,
  type UserInputHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input'
import { UserMessageContent } from '@/app/workspace/[workspaceId]/home/components/user-message-content'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageContext,
  ContentBlock,
  FileAttachmentForApi,
  MothershipResource,
  QueuedMessage,
} from '@/app/workspace/[workspaceId]/home/types'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import type { ChatContext } from '@/stores/panel'
import { MothershipChatSkeleton } from './components/mothership-chat-skeleton'

interface MothershipChatProps {
  messages: ChatMessage[]
  isSending: boolean
  isReconnecting?: boolean
  isLoading?: boolean
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => void
  onStopGeneration: () => void
  messageQueue: QueuedMessage[]
  editingQueuedId: string | null
  dispatchingHeadId: string | null
  onRemoveQueuedMessage: (id: string) => void
  onSendQueuedMessage: (id: string) => Promise<void>
  onEditQueuedMessage: (id: string) => QueuedMessage | undefined
  onCancelQueueEdit: () => void
  userId?: string
  chatId?: string
  onContextAdd?: (context: ChatContext) => void
  onContextRemove?: (context: ChatContext) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
  draftScopeKey?: string
  layout?: 'mothership-view' | 'copilot-view'
  initialScrollBlocked?: boolean
  animateInput?: boolean
  onInputAnimationEnd?: () => void
  className?: string
  inlineStatus?: ReactNode
}

/**
 * Per-role row-height estimates seed the virtualizer before each row is measured.
 * They only size the scrollbar for not-yet-rendered rows — every visible row is
 * measured precisely via `measureElement` — so approximate values suffice. Split
 * by role because user bubbles are short and assistant turns are tall; a single
 * blended number would over/under-shoot both and drift the scrollbar more.
 */
const ROW_HEIGHT_ESTIMATE = {
  'mothership-view': { user: 64, assistant: 280 },
  'copilot-view': { user: 48, assistant: 180 },
} as const

/**
 * Rows render farther beyond the viewport edges than the default so fast scroll
 * and the streaming tail stay painted without a blank flash before measurement.
 */
const OVERSCAN = 6

/**
 * How close to the bottom (px) the transcript must be to count as pinned for
 * re-pinning across container resizes. Covers the fractional sub-pixel gap a
 * DPR-scaled `scrollTop` can leave, without capturing a user who deliberately
 * scrolled up.
 */
const PIN_THRESHOLD = 2

/**
 * Initial-scroll sentinel. Distinct from every real `chatId` value — including
 * `undefined` (a not-yet-persisted chat) — so the first scroll-to-bottom fires
 * even before a chat has an id, instead of treating `undefined` as "already
 * scrolled this chat".
 */
const UNSCROLLED = Symbol('unscrolled')

const LAYOUT_STYLES = {
  'mothership-view': {
    scrollContainer:
      'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-8 [scrollbar-gutter:stable_both-edges]',
    sizer: 'relative mx-auto w-full max-w-[48rem]',
    rowGap: 'pb-6',
    userRow: 'flex flex-col items-end gap-[6px] pt-3',
    attachmentWidth: 'max-w-[70%]',
    userBubble: 'max-w-[70%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2',
    assistantRow: 'group/msg',
    footer: 'flex-shrink-0 px-[24px] pb-[16px]',
    footerInner: 'mx-auto max-w-[48rem]',
  },
  'copilot-view': {
    scrollContainer: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-4',
    sizer: 'relative w-full',
    rowGap: 'pb-4',
    userRow: 'flex flex-col items-end gap-[6px] pt-2',
    attachmentWidth: 'max-w-[85%]',
    userBubble: 'max-w-[85%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3 py-2',
    assistantRow: 'group/msg',
    footer: 'flex-shrink-0 px-3 pb-3',
    footerInner: '',
  },
} as const

const EMPTY_BLOCKS: ContentBlock[] = []

interface UserMessageRowProps {
  content: string
  contexts?: ChatMessageContext[]
  attachments?: ChatMessageAttachment[]
  rowClassName: string
  bubbleClassName: string
  attachmentWidthClassName: string
}

const UserMessageRow = memo(function UserMessageRow({
  content,
  contexts,
  attachments,
  rowClassName,
  bubbleClassName,
  attachmentWidthClassName,
}: UserMessageRowProps) {
  const hasAttachments = Boolean(attachments?.length)
  return (
    <div className={rowClassName}>
      {hasAttachments && (
        <ChatMessageAttachments
          attachments={attachments ?? []}
          align='end'
          className={attachmentWidthClassName}
        />
      )}
      <div className={bubbleClassName}>
        <UserMessageContent content={content} contexts={contexts} />
      </div>
    </div>
  )
})

interface AssistantMessageRowProps {
  message: ChatMessage
  isStreaming: boolean
  precedingUserContent?: string
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  rowClassName: string
  onOptionSelect?: (id: string) => void
  onAnimatingChange?: (animating: boolean) => void
}

const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  isStreaming,
  precedingUserContent,
  questionAnswers,
  rowClassName,
  onOptionSelect,
  onAnimatingChange,
}: AssistantMessageRowProps) {
  const blocks = message.contentBlocks ?? EMPTY_BLOCKS
  const hasAnyBlocks = blocks.length > 0
  const trimmedContent = message.content?.trim() ?? ''

  const [phase, setPhase] = useState<MessagePhase>(isStreaming ? 'streaming' : 'settled')

  const onAnimatingChangeRef = useRef(onAnimatingChange)
  onAnimatingChangeRef.current = onAnimatingChange
  useEffect(() => {
    onAnimatingChangeRef.current?.(phase !== 'settled')
  }, [phase])

  if (!hasAnyBlocks && !trimmedContent && isStreaming) {
    return <PendingTagIndicator />
  }

  const hasRenderableAssistant = assistantMessageHasRenderableContent(blocks, message.content ?? '')
  if (!hasRenderableAssistant && !trimmedContent && !isStreaming) {
    return null
  }

  // A message that ends with a question card is an input surface, not a
  // reactable assistant turn: no copy/thumbs row beneath the card, whether
  // the card is awaiting answers or collapsed to its recap.
  const endsWithQuestion = trimmedContent.endsWith('</question>')
  const showActions = phase === 'settled' && !endsWithQuestion && (message.content || hasAnyBlocks)

  return (
    <div className={rowClassName}>
      <MessageContent
        blocks={blocks}
        fallbackContent={message.content}
        isStreaming={isStreaming}
        questionAnswers={questionAnswers}
        onOptionSelect={onOptionSelect}
        onPhaseChange={setPhase}
      />
      {showActions && (
        <div className='mt-2.5'>
          <MessageActions
            content={message.content}
            userQuery={precedingUserContent}
            requestId={message.requestId}
            messageId={message.id}
          />
        </div>
      )}
    </div>
  )
})

export function MothershipChat({
  messages: messagesProp,
  isSending,
  isReconnecting = false,
  isLoading = false,
  onSubmit,
  onStopGeneration,
  messageQueue,
  editingQueuedId,
  dispatchingHeadId,
  onRemoveQueuedMessage,
  onSendQueuedMessage,
  onEditQueuedMessage,
  onCancelQueueEdit,
  userId,
  chatId,
  onContextAdd,
  onContextRemove,
  onWorkspaceResourceSelect,
  draftScopeKey,
  layout = 'mothership-view',
  initialScrollBlocked = false,
  animateInput = false,
  onInputAnimationEnd,
  className,
  inlineStatus,
}: MothershipChatProps) {
  const styles = LAYOUT_STYLES[layout]
  const isStreamActive = isSending || isReconnecting
  /**
   * Defer the streamed message list so its re-render (virtualizer + rows) is
   * low-priority: React yields it to urgent interactions (dragging/panning the
   * side-panel canvas, scrolling, typing), keeping those at 60fps instead of
   * starving the main thread on every streaming token.
   */
  const messages = useDeferredValue(messagesProp)
  const [lastRowAnimating, setLastRowAnimating] = useState(false)
  const scrollElementRef = useRef<HTMLDivElement | null>(null)
  const { ref: autoScrollRef } = useAutoScroll(isStreamActive || lastRowAnimating)
  const setScrollElement = useCallback(
    (el: HTMLDivElement | null) => {
      scrollElementRef.current = el
      autoScrollRef(el)
    },
    [autoScrollRef]
  )

  const hasMessages = messages.length > 0

  /**
   * Keep a bottom-pinned transcript pinned when the scroll container resizes.
   * Growing or shrinking the multi-line input (or resizing the panel/window)
   * changes the container height while `scrollTop` stays put, which silently
   * unpins the chat from the bottom — the last message slides behind the
   * input. Pinned-ness is sampled on every scroll (before the resize lands),
   * so a user who scrolled up is never yanked back down.
   */
  useEffect(() => {
    const el = scrollElementRef.current
    if (!el) return
    let wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD
    const onScroll = () => {
      wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD
    }
    const observer = new ResizeObserver(() => {
      if (wasAtBottom) el.scrollTop = el.scrollHeight - el.clientHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  /**
   * Stable per-row identity for virtualizer measurement caching and React
   * reconciliation. User rows key on their message id; assistant rows key on
   * their turn position (`assistant:<userId>:<ordinal>`) so a streaming
   * placeholder keeps the same element — and its smooth-text state — when the
   * persisted message arrives with a new id.
   */
  const rowKeyByIndex = useMemo(() => {
    const out: string[] = []
    let lastUserId: string | undefined
    let ordinal = 0
    for (const [index, message] of messages.entries()) {
      if (message.role === 'user') {
        lastUserId = message.id
        ordinal = 0
        out[index] = message.id
      } else {
        out[index] = lastUserId ? `assistant:${lastUserId}:${ordinal++}` : message.id
      }
    }
    return out
  }, [messages])

  const precedingUserContentByIndex = useMemo(() => {
    const out: Array<string | undefined> = []
    let lastUserContent: string | undefined
    for (const [index, message] of messages.entries()) {
      out[index] = lastUserContent
      if (message.role === 'user') lastUserContent = message.content
    }
    return out
  }, [messages])

  /**
   * Pairs each assistant question card with the user message that answered it
   * (strict `Prompt — Answer` match). The paired user message is hidden — the
   * answered card IS the user turn — and the assistant row renders the card
   * as a recap with these answers, both live and after reload.
   */
  const questionPairing = useMemo(() => {
    const answersByIndex: Array<string[] | undefined> = []
    const hiddenUserByIndex: Array<boolean | undefined> = []
    for (const [index, message] of messages.entries()) {
      if (message.role !== 'assistant') continue
      // Check the answering user message BEFORE scanning content: a pairing
      // needs one anyway, and this skips the O(content) `includes` scan over
      // the still-growing streaming message (always the last row) on every
      // snapshot flush.
      const next = messages[index + 1]
      if (!next || next.role !== 'user' || !next.content) continue
      if (!message.content?.includes('</question>')) continue
      const questions = parseLastQuestionTag(message.content)
      if (!questions) continue
      const answers = parseQuestionAnswerMessage(questions, next.content)
      if (!answers) continue
      answersByIndex[index] = answers
      hiddenUserByIndex[index + 1] = true
    }
    return { answersByIndex, hiddenUserByIndex }
  }, [messages])

  /**
   * Always keep the last row in the rendered window. It is the live/streaming
   * row; unmounting it (by scrolling far enough up that it leaves the overscan
   * window) and remounting it mid-stream would reset its smooth-text reveal
   * state and re-fire the fade-in animation — a visible flash. Pinning it costs
   * one extra always-mounted row.
   */
  const lastIndex = messages.length - 1
  const lastRowKey = lastIndex >= 0 ? rowKeyByIndex[lastIndex] : undefined
  useEffect(() => {
    setLastRowAnimating(false)
  }, [lastRowKey])

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (lastIndex >= 0 && !indexes.includes(lastIndex)) {
        indexes.push(lastIndex)
      }
      return indexes
    },
    [lastIndex]
  )

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => {
      const estimate = ROW_HEIGHT_ESTIMATE[layout]
      return messages[index]?.role === 'user' ? estimate.user : estimate.assistant
    },
    overscan: OVERSCAN,
    getItemKey: (index) => rowKeyByIndex[index] ?? index,
    rangeExtractor,
  })

  /**
   * Instance property — silently ignored if passed as a `useVirtualizer`
   * option. Skips scroll compensation for the streaming last row: it starts
   * above the viewport but grows at its bottom edge, so the default dragged
   * the viewport down in lockstep with growth even after the user scrolled
   * away. Other rows keep the library default.
   */
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.index !== lastIndex && item.start < (instance.scrollElement?.scrollTop ?? 0)

  const scrolledChatRef = useRef<string | undefined | typeof UNSCROLLED>(UNSCROLLED)
  const userInputRef = useRef<UserInputHandle>(null)
  const messageQueueRef = useRef(messageQueue)
  useEffect(() => {
    messageQueueRef.current = messageQueue
  }, [messageQueue])

  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])
  const stableOnOptionSelect = useCallback((id: string) => {
    onSubmitRef.current(id)
  }, [])

  const handleSendQueuedHead = useCallback(() => {
    const topMessage = messageQueueRef.current[0]
    if (!topMessage) return
    void onSendQueuedMessage(topMessage.id)
  }, [onSendQueuedMessage])

  const handleEditQueued = useCallback(
    (id: string) => {
      const msg = onEditQueuedMessage(id)
      if (msg) userInputRef.current?.loadQueuedMessage(msg)
    },
    [onEditQueuedMessage]
  )

  const handleEditQueuedTail = useCallback(() => {
    const tail = messageQueueRef.current[messageQueueRef.current.length - 1]
    if (!tail) return
    handleEditQueued(tail.id)
  }, [handleEditQueued])

  /**
   * Land at the most recent message once per chat — on open and when switching
   * chats. The ref tracks which `chatId` we last scrolled for (seeded with
   * {@link UNSCROLLED} so a pending, id-less chat still scrolls on first mount),
   * so it re-fires on a genuine chat switch, including between chats of equal
   * length. A pending chat persisting its id (`undefined` → string) is the SAME
   * conversation, so adopt the id without re-scrolling — otherwise the viewport
   * would snap back to the bottom after the user scrolled up mid-stream. Runs
   * before paint so a long transcript never flashes at the top. Subsequent
   * growth within the same chat is handled by {@link useAutoScroll}'s streaming
   * sticky-scroll, not here.
   */
  useLayoutEffect(() => {
    const scrolledFor = scrolledChatRef.current
    if (!hasMessages || initialScrollBlocked || scrolledFor === chatId) return
    const isPendingPersist = scrolledFor === undefined && chatId !== undefined
    scrolledChatRef.current = chatId
    if (isPendingPersist) return
    virtualizer.scrollToIndex(lastIndex, { align: 'end' })
  }, [chatId, hasMessages, initialScrollBlocked, lastIndex, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <ChatSurfaceProvider
      chatId={chatId}
      userId={userId}
      onContextAdd={onContextAdd}
      onContextRemove={onContextRemove}
      onWorkspaceResourceSelect={onWorkspaceResourceSelect}
    >
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <div ref={setScrollElement} className={styles.scrollContainer}>
          {isLoading && !hasMessages ? (
            <MothershipChatSkeleton layout={layout} />
          ) : (
            <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((virtualItem) => {
                const index = virtualItem.index
                const msg = messages[index]
                const isLast = index === lastIndex
                return (
                  <div
                    key={virtualItem.key}
                    data-index={index}
                    ref={virtualizer.measureElement}
                    className='absolute top-0 left-0 w-full'
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    {msg.role === 'user' ? (
                      questionPairing.hiddenUserByIndex[index] ? null : (
                        <UserMessageRow
                          content={msg.content}
                          contexts={msg.contexts}
                          attachments={msg.attachments}
                          rowClassName={cn(styles.userRow, styles.rowGap)}
                          bubbleClassName={styles.userBubble}
                          attachmentWidthClassName={styles.attachmentWidth}
                        />
                      )
                    ) : (
                      <AssistantMessageRow
                        message={msg}
                        isStreaming={isStreamActive && isLast}
                        precedingUserContent={precedingUserContentByIndex[index]}
                        questionAnswers={questionPairing.answersByIndex[index]}
                        rowClassName={cn(styles.assistantRow, styles.rowGap)}
                        onOptionSelect={isLast ? stableOnOptionSelect : undefined}
                        onAnimatingChange={isLast ? setLastRowAnimating : undefined}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {inlineStatus ? <div className='flex-shrink-0 px-6'>{inlineStatus}</div> : null}

        <div
          className={cn(styles.footer, animateInput && 'animate-slide-in-bottom')}
          onAnimationEnd={animateInput ? onInputAnimationEnd : undefined}
        >
          <div className={styles.footerInner}>
            <QueuedMessages
              messageQueue={messageQueue}
              editingQueuedId={editingQueuedId}
              dispatchingHeadId={dispatchingHeadId}
              onRemove={onRemoveQueuedMessage}
              onSendNow={onSendQueuedMessage}
              onEdit={handleEditQueued}
              onCancelEdit={onCancelQueueEdit}
            />
            <UserInput
              ref={userInputRef}
              onSubmit={onSubmit}
              isSending={isStreamActive}
              onStopGeneration={onStopGeneration}
              isInitialView={false}
              onSendQueuedHead={handleSendQueuedHead}
              onEditQueuedTail={handleEditQueuedTail}
              draftScopeKey={draftScopeKey}
            />
          </div>
        </div>
      </div>
    </ChatSurfaceProvider>
  )
}
