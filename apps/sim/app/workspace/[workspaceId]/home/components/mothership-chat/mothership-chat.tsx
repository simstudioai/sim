'use client'

import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type ClipboardContent, cn } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { SMOOTH_CHASE_RATE } from '@/lib/core/utils/smooth-bottom-chase'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { MessageActions } from '@/app/workspace/[workspaceId]/components'
import { ChatMessageAttachments } from '@/app/workspace/[workspaceId]/home/components/chat-message-attachments'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  assistantMessageHasRenderableContent,
  getOrchestratorMessageText,
  MessageContent,
  type MessagePhase,
} from '@/app/workspace/[workspaceId]/home/components/message-content'
import { parseQuestionAnswerMessage } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import {
  type CredentialSubmissionPayload,
  credentialTagHasVisibleCard,
  parseCredentialSubmissionProgress,
  parseLastCredentialTag,
  parseLastQuestionTag,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import {
  prepareCopyableMarkdown,
  toCopyableMarkdown,
} from '@/app/workspace/[workspaceId]/home/components/mothership-chat/copyable-markdown'
import { nextSizerFloor } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/sizer-floor'
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
  QueuedMessage,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
import { useOptionalWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getWorkspaceFilesQueryOptions, workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import type { ChatContext } from '@/stores/panel'
import { MothershipChatSkeleton } from './components/mothership-chat-skeleton'
import { shouldShowAssistantMessageActions } from './message-actions-visibility'

interface MothershipChatProps {
  workspaceId?: string
  composer?: ReactNode
  messages: ChatMessage[]
  isSending: boolean
  /** The composer's Search-mode results, shown above the input. */
  searchResults?: ReactNode
  /** The live search query; the composer shows it so the box and the results never disagree. */
  searchQuery?: string
  /** The composer, for a caller that hands a question to the agent from outside the box. */
  userInputRef?: RefObject<UserInputHandle | null>
  /** Puts the composer in the mode a queued message was written in, when one is loaded for editing. */
  onRestoreQueuedMode?: (requestMode: QueuedMessage['requestMode']) => void
  isReconnecting?: boolean
  isLoading?: boolean
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => void
  /** Whether the composer offers Search mode; only the Home composer answers a search. */
  canSearch?: boolean
  /** Off in Search mode, where the query stays put so the person can refine it. */
  clearOnSubmit?: boolean
  /** Fires when the composer's text goes from something to nothing. */
  onCleared?: () => void
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
  /**
   * Receives the input's context list AFTER the removal, so the owner can tell
   * whether another chip still references the removed chip's resource. Matches
   * `ChatSurfaceContextValue`, which this forwards to.
   */
  onContextRemove?: (context: ChatContext, remaining: ChatContext[]) => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
  draftScopeKey?: string
  layout?: 'mothership-view' | 'copilot-view'
  initialScrollBlocked?: boolean
  animateInput?: boolean
  onInputAnimationEnd?: () => void
  className?: string
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
      'mt-[var(--workspace-content-title-bar-inset)] min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-2 [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]',
    sizer: 'relative mx-auto w-full max-w-chat',
    rowGap: 'pb-6',
    userRow: 'flex flex-col items-end gap-[6px] pt-3',
    attachmentWidth: 'max-w-[70%]',
    userBubble: 'max-w-[70%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2',
    assistantRow: 'group/msg',
    footer: 'shrink-0 px-[24px] pb-[16px]',
    footerInner: 'mx-auto max-w-chat',
  },
  'copilot-view': {
    scrollContainer:
      'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-4 [overflow-anchor:none]',
    sizer: 'relative w-full',
    rowGap: 'pb-4',
    userRow: 'flex flex-col items-end gap-[6px] pt-2',
    attachmentWidth: 'max-w-[85%]',
    userBubble: 'max-w-[85%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3 py-2',
    assistantRow: 'group/msg',
    footer: 'shrink-0 px-3 pb-3',
    footerInner: '',
  },
} as const

const EMPTY_BLOCKS: ContentBlock[] = []
const EMPTY_WORKSPACE_FILES: readonly WorkspaceFileRecord[] = []

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
  prepareContentForCopy: (content: string) => ClipboardContent
  isStreaming: boolean
  isLast: boolean
  precedingUserContent: string | undefined
  requestMode?: ChatMessage['requestMode']
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  /** The user moved on without submitting this message's credential card. */
  credentialAbandoned?: boolean
  rowClassName: string
  onOptionSelect?: (id: string) => void
  onAnimatingChange?: (animating: boolean) => void
}

const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  prepareContentForCopy,
  isStreaming,
  isLast,
  precedingUserContent,
  requestMode,
  questionAnswers,
  credentialSubmission,
  credentialAbandoned,
  rowClassName,
  onOptionSelect,
  onAnimatingChange,
}: AssistantMessageRowProps) {
  const permissions = useOptionalWorkspacePermissionsContext()
  const canEdit = permissions?.userPermissions.canEdit ?? false
  const blocks = message.contentBlocks ?? EMPTY_BLOCKS
  const hasAnyBlocks = blocks.length > 0
  const trimmedContent = message.content?.trim() ?? ''

  const [phase, setPhase] = useState<MessagePhase>(isStreaming ? 'streaming' : 'settled')
  const [dismissedQuestionTag, setDismissedQuestionTag] = useState<string | null>(null)

  const onAnimatingChangeRef = useRef(onAnimatingChange)
  onAnimatingChangeRef.current = onAnimatingChange
  useEffect(() => {
    onAnimatingChangeRef.current?.(phase !== 'settled')
  }, [phase])

  const getCopyContent = useCallback(
    () => getOrchestratorMessageText(blocks, message.content),
    [blocks, message.content]
  )
  const hasRenderableAssistant = assistantMessageHasRenderableContent(blocks, message.content ?? '')
  if (!hasRenderableAssistant && !trimmedContent && !isStreaming) {
    return null
  }

  // A trailing question or credential card replaces the copy/thumbs row while
  // active or answered. A question's raw tag is its dismissal identity so a
  // later question added to the same turn cannot inherit an earlier dismissal.
  const endsWithQuestion = trimmedContent.endsWith('</question>')
  const endsWithCredential = trimmedContent.endsWith('</credential>')
  const trailingCredentials = endsWithCredential ? parseLastCredentialTag(trimmedContent) : null
  const showsCredentialCard = trailingCredentials
    ? credentialTagHasVisibleCard(trailingCredentials, canEdit, message.requestMode ?? requestMode)
    : false
  const questionTag = endsWithQuestion
    ? trimmedContent.slice(trimmedContent.lastIndexOf('<question>'))
    : null
  const questionDismissed = questionTag !== null && dismissedQuestionTag === questionTag
  const handleQuestionDismiss = () => {
    if (questionTag) setDismissedQuestionTag(questionTag)
  }
  // Settle timing lives in MessageContent (the actions take the thinking
  // slot's place in the same render), so eligibility here is phase-free:
  // `phase: 'settled'` asks the helper "would a settled turn show them?".
  const actionsEligible = shouldShowAssistantMessageActions({
    phase: 'settled',
    hasContent: Boolean(message.content) || hasAnyBlocks,
    endsWithInteraction: endsWithQuestion || showsCredentialCard,
    questionDismissed,
  })

  // A visible interaction card (active or answered recap) sits 12px below the
  // preceding prose (chat-content's `space-y-3`). The row's default `pb-6`
  // would leave 24px underneath — asymmetric. Shrink the trailing gap to match
  // so the card breathes equally top and bottom. Dismissed cards fall back to
  // the normal message rhythm (they render the standard actions row instead).
  const showsInteractionCard = (endsWithQuestion && !questionDismissed) || showsCredentialCard

  return (
    <div className={cn(rowClassName, showsInteractionCard && 'pb-3')}>
      <MessageContent
        messageId={message.id}
        requestMode={message.requestMode ?? requestMode}
        blocks={blocks}
        fallbackContent={message.content}
        isStreaming={isStreaming}
        isLast={isLast}
        questionAnswers={questionAnswers}
        credentialSubmission={credentialSubmission}
        credentialAbandoned={credentialAbandoned}
        onOptionSelect={onOptionSelect}
        onQuestionDismiss={handleQuestionDismiss}
        onPhaseChange={setPhase}
        actions={
          actionsEligible ? (
            <MessageActions
              content={message.content}
              getCopyContent={getCopyContent}
              hasCopyContent={Boolean(getOrchestratorMessageText(blocks, message.content).trim())}
              prepareContentForCopy={prepareContentForCopy}
              userQuery={precedingUserContent}
              requestId={message.requestId}
              messageId={message.id}
            />
          ) : undefined
        }
      />
    </div>
  )
})

export function MothershipChat({
  workspaceId,
  composer,
  messages: messagesProp,
  isSending,
  searchResults,
  searchQuery,
  userInputRef: userInputRefProp,
  onRestoreQueuedMode,
  isReconnecting = false,
  isLoading = false,
  onSubmit,
  canSearch = false,
  clearOnSubmit,
  onCleared,
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
}: MothershipChatProps) {
  const queryClient = useQueryClient()
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
  const sizerRef = useRef<HTMLDivElement | null>(null)
  const scrollerPaddingRef = useRef<{ top: number; bottom: number } | null>(null)
  const sizerFloorAppliedRef = useRef(0)
  const heldHighWaterRef = useRef(0)
  const floorChatRef = useRef<string | undefined>(undefined)
  const floorDrainRafRef = useRef(0)
  const prepareContentForCopy = useCallback(
    (content: string) =>
      workspaceId
        ? prepareCopyableMarkdown(
            content,
            queryClient.getQueryData<readonly WorkspaceFileRecord[]>(
              workspaceFilesKeys.list(workspaceId)
            ) ?? EMPTY_WORKSPACE_FILES,
            () =>
              queryClient.fetchQuery({
                ...getWorkspaceFilesQueryOptions(workspaceId),
                staleTime: 0,
              })
          )
        : toCopyableMarkdown(content),
    [queryClient, workspaceId]
  )
  useEffect(() => () => cancelAnimationFrame(floorDrainRafRef.current), [])

  /**
   * Sizer floor while streaming: `scrollHeight` must never dip below the
   * current viewport bottom. Streaming markdown re-parse emits transient
   * row-height shrinks; when they pull scrollHeight under
   * `scrollTop + clientHeight`, the browser clamps `scrollTop` and the pinned
   * transcript visibly drops, then the chase glides it back. Flooring the
   * sizer prevents that clamp while never ADDING space, so an estimate
   * correction (a fresh row measuring smaller than ROW_HEIGHT_ESTIMATE)
   * releases immediately instead of holding phantom space the chase would
   * scroll into and bounce back out of. {@link nextSizerFloor} owns the value
   * and the invariant that keeps it honest.
   *
   * Active on the same signal as auto-scroll: the reveal keeps re-parsing
   * markdown (and shrinking) after the network stream closes, so the floor
   * must hold through `lastRowAnimating` too.
   *
   * Release is DRAINED, not cliffed: while active the floor forbids
   * scrollHeight from dropping, so permanent shrinks over the turn accrue as
   * phantom space (debt). Clearing min-height in one commit released that
   * whole debt as a single clamp — the end-of-turn downward jump. Instead the
   * floor glides down to the natural size at the chase's rate; the browser's
   * clamp follows a few px per frame, which reads as the same eased settle as
   * the rest of the stream. Instant-clears when the debt is sub-pixel or the
   * user isn't pinned (shrinking below-viewport space is invisible then).
   */
  const floorActive = isStreamActive || lastRowAnimating
  useLayoutEffect(() => {
    const sizer = sizerRef.current
    const el = scrollElementRef.current
    if (!sizer || !el) return
    // A chat switch replaces the entire transcript, so a floor held for the
    // previous one is meaningless — and its high-water mark would otherwise
    // hand a short chat the tall chat's space for as long as the outgoing
    // turn's `lastRowAnimating` keeps the floor engaged. Released outright
    // rather than drained: the switch re-lands the viewport anyway, so there
    // is no eased settle to preserve. A pending chat adopting its id is the
    // SAME conversation, so it must not release mid-turn.
    if (floorChatRef.current !== chatId) {
      const isPendingPersist = floorChatRef.current === undefined && chatId !== undefined
      floorChatRef.current = chatId
      if (!isPendingPersist) {
        cancelAnimationFrame(floorDrainRafRef.current)
        floorDrainRafRef.current = 0
        sizerFloorAppliedRef.current = 0
        heldHighWaterRef.current = 0
        sizer.style.minHeight = ''
      }
    }
    if (!floorActive) {
      heldHighWaterRef.current = 0
      if (sizerFloorAppliedRef.current === 0) return
      // A drain already in flight keeps its own rAF cadence — settle-burst
      // commits re-enter this branch and must not add extra steps in layout,
      // which would accelerate the release past the eased rate.
      if (floorDrainRafRef.current !== 0) return
      scrollerPaddingRef.current = null
      const drain = () => {
        const target = virtualizer.getTotalSize()
        const current = sizerFloorAppliedRef.current
        if (current === 0) {
          floorDrainRafRef.current = 0
          return
        }
        // Instant-clear only when the whole remaining debt sits BELOW the
        // viewport (debt ≤ distance-from-bottom) — then the shrink is
        // invisible. A merely-unpinned viewport with debt larger than its
        // slack would still clamp, so it keeps the eased drain instead.
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight
        const debt = current - target
        if (debt <= 1 || debt <= distance) {
          sizerFloorAppliedRef.current = 0
          floorDrainRafRef.current = 0
          sizer.style.minHeight = ''
          return
        }
        const next = Math.floor(current - Math.max(1, debt * SMOOTH_CHASE_RATE))
        sizerFloorAppliedRef.current = next
        sizer.style.minHeight = `${next}px`
        floorDrainRafRef.current = requestAnimationFrame(drain)
      }
      floorDrainRafRef.current = requestAnimationFrame(drain)
      return
    }
    cancelAnimationFrame(floorDrainRafRef.current)
    floorDrainRafRef.current = 0
    if (!scrollerPaddingRef.current) {
      const style = getComputedStyle(el)
      scrollerPaddingRef.current = {
        top: Number.parseFloat(style.paddingTop),
        bottom: Number.parseFloat(style.paddingBottom),
      }
    }
    const padding = scrollerPaddingRef.current
    const { floor, highWater } = nextSizerFloor({
      previousHighWater: heldHighWaterRef.current,
      appliedFloor: sizerFloorAppliedRef.current,
      contentHeight: virtualizer.getTotalSize(),
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      paddingTop: padding.top,
      paddingBottom: padding.bottom,
    })
    heldHighWaterRef.current = highWater
    // Dead-band: the floor feeds back into its own inputs (a floored value can
    // land a fraction BELOW the extent, the browser clamps scrollTop, and the
    // next commit re-derives from the clamped position — a visible ~1px×N
    // downward cascade on fractional-scrollTop displays). Sub-pixel deltas are
    // rounding noise from that loop, never real growth; only apply real moves.
    if (Math.abs(floor - sizerFloorAppliedRef.current) <= 1) return
    sizerFloorAppliedRef.current = floor
    sizer.style.minHeight = `${floor}px`
  })
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

  const precedingUserByIndex = useMemo(() => {
    const out: Array<ChatMessage | undefined> = []
    let lastUser: ChatMessage | undefined
    for (const [index, message] of messages.entries()) {
      out[index] = lastUser
      if (message.role === 'user') lastUser = message
    }
    return out
  }, [messages])

  /**
   * Pairs each assistant question/credential card with the user message that
   * completed it. The paired user message is hidden — the answered card IS the
   * user turn — and the assistant row renders a recap both live and on reload.
   *
   * A credential card the user talked past instead of submitting is marked
   * abandoned: the turn is over, so it collapses to the same recap (every row
   * it has no progress for reads "Skipped") rather than sitting in the
   * transcript as a live form nobody can complete anymore.
   */
  const interactionPairing = useMemo(() => {
    const answersByIndex: Array<string[] | undefined> = []
    const credentialSubmissionByIndex: Array<CredentialSubmissionPayload | undefined> = []
    const credentialAbandonedByIndex: Array<boolean | undefined> = []
    const hiddenUserByIndex: Array<boolean | undefined> = []
    let lastUserIndex = -1
    for (const [index, message] of messages.entries()) {
      if (message.role === 'user') lastUserIndex = index
    }
    for (const [index, message] of messages.entries()) {
      if (message.role !== 'assistant') continue
      // Check the surrounding user turns BEFORE scanning content: a pairing
      // needs an answering message and abandonment needs a later one, and this
      // skips the O(content) `includes` scan over the still-growing streaming
      // message (always the last row) on every snapshot flush.
      const next = messages[index + 1]
      const answer = next?.role === 'user' && next.content ? next.content : null
      const superseded = index < lastUserIndex
      if (!answer && !superseded) continue
      if (answer && message.content?.includes('</question>')) {
        const questions = parseLastQuestionTag(message.content)
        const answers = questions ? parseQuestionAnswerMessage(questions, answer) : null
        if (answers) {
          answersByIndex[index] = answers
          hiddenUserByIndex[index + 1] = true
          continue
        }
      }
      if (message.content?.includes('</credential>')) {
        const credentials = parseLastCredentialTag(message.content)
        const submission =
          answer && credentials ? parseCredentialSubmissionProgress(credentials, answer) : null
        if (submission) {
          credentialSubmissionByIndex[index] = submission
          hiddenUserByIndex[index + 1] = true
        } else if (superseded) {
          credentialAbandonedByIndex[index] = true
        }
      }
    }
    return {
      answersByIndex,
      credentialSubmissionByIndex,
      credentialAbandonedByIndex,
      hiddenUserByIndex,
    }
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
    // Measure in a rAF instead of synchronously inside ResizeObserver delivery.
    // A window resize re-wraps every row once the chat column falls under the
    // 48rem cap — which is exactly what happens while the resource panel is
    // open — and each synchronous re-measure writes scrollTop and copies the
    // size cache mid-callback, so the frame re-lays-out once per visible row.
    useAnimationFrameWithResizeObserver: true,
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
  const ownUserInputRef = useRef<UserInputHandle>(null)
  const userInputRef = userInputRefProp ?? ownUserInputRef
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
      if (!msg) return
      onRestoreQueuedMode?.(msg.requestMode)
      userInputRef.current?.loadQueuedMessage(msg)
    },
    [onEditQueuedMessage, onRestoreQueuedMode, userInputRef]
  )

  const handleEditQueuedTail = useCallback(() => {
    const tail = messageQueueRef.current[messageQueueRef.current.length - 1]
    if (!tail) return
    handleEditQueued(tail.id)
  }, [handleEditQueued])

  /**
   * A drag-selection that overshoots a message's last line crosses the row
   * wrappers' block boundaries, which the clipboard serializer renders as
   * trailing newlines — every copied response pasted with blank lines
   * appended. Rewrite the plain-text flavor trimmed; the rich flavor is
   * re-serialized from the selection so formatted pastes keep working.
   */
  const handleCopy = useCallback((event: React.ClipboardEvent) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !event.clipboardData) return
    const text = selection.toString()
    const trimmed = text.replace(/\s+$/, '')
    if (trimmed === text) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', trimmed)
    const html = document.createElement('div')
    for (let i = 0; i < selection.rangeCount; i++) {
      html.appendChild(selection.getRangeAt(i).cloneContents())
    }
    event.clipboardData.setData('text/html', html.innerHTML)
  }, [])

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
        <div ref={setScrollElement} className={styles.scrollContainer} onCopy={handleCopy}>
          {isLoading && !hasMessages ? (
            <MothershipChatSkeleton layout={layout} />
          ) : (
            <div
              ref={sizerRef}
              className={styles.sizer}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualItems.map((virtualItem) => {
                const index = virtualItem.index
                const msg = messages[index]
                const isLast = index === lastIndex
                return (
                  <div
                    key={virtualItem.key}
                    data-index={index}
                    ref={virtualizer.measureElement}
                    /* Positioned with a real `top`, NOT `top-0` + translateY:
                       text selection maps a drag's start point to a text
                       position via the rows' LAYOUT boxes, and with every row
                       laid out at y=0 a drag starting in the gutter anchors in
                       the wrong row — selections ran upward from a downward
                       drag. Transforms move paint and hit-testing but not the
                       layout box that mapping falls back to. */
                    className='absolute left-0 w-full'
                    style={{ top: virtualItem.start }}
                  >
                    {msg.role === 'user' ? (
                      interactionPairing.hiddenUserByIndex[index] ? null : (
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
                        prepareContentForCopy={prepareContentForCopy}
                        isStreaming={isStreamActive && isLast}
                        isLast={isLast}
                        precedingUserContent={precedingUserByIndex[index]?.content}
                        requestMode={precedingUserByIndex[index]?.requestMode}
                        questionAnswers={interactionPairing.answersByIndex[index]}
                        credentialSubmission={interactionPairing.credentialSubmissionByIndex[index]}
                        credentialAbandoned={interactionPairing.credentialAbandonedByIndex[index]}
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

        <div
          className={cn(styles.footer, animateInput && 'animate-slide-in-bottom')}
          onAnimationEnd={animateInput ? onInputAnimationEnd : undefined}
        >
          <div className={styles.footerInner}>
            {searchResults && (
              <div className='max-h-[40vh] overflow-y-auto pb-2'>{searchResults}</div>
            )}
            <QueuedMessages
              messageQueue={messageQueue}
              editingQueuedId={editingQueuedId}
              dispatchingHeadId={dispatchingHeadId}
              onRemove={onRemoveQueuedMessage}
              onSendNow={onSendQueuedMessage}
              onEdit={handleEditQueued}
              onCancelEdit={onCancelQueueEdit}
            />
            {!isLoading &&
              (composer ?? (
                <UserInput
                  key={draftScopeKey}
                  ref={userInputRef}
                  defaultValue={searchQuery}
                  onSubmit={onSubmit}
                  canSearch={canSearch}
                  clearOnSubmit={clearOnSubmit}
                  onCleared={onCleared}
                  isSending={isStreamActive}
                  onStopGeneration={onStopGeneration}
                  isInitialView={false}
                  onSendQueuedHead={handleSendQueuedHead}
                  onEditQueuedTail={handleEditQueuedTail}
                  draftScopeKey={draftScopeKey}
                />
              ))}
          </div>
        </div>
      </div>
    </ChatSurfaceProvider>
  )
}
