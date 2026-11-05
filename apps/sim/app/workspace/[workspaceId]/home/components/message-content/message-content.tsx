'use client'

import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn'
import { CircleStop } from '@sim/emcn/icons'
import { useAssistantActionLayout } from '@/components/assistant-actions'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  hasAgentGroupItemContent,
  hasPendingAgentGroup,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import {
  getTurnLiveIndicators,
  ownsTurnWait,
  type TurnLiveIndicators,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import type { CredentialSubmissionPayload } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { WatchActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/watch-activity/watch-activity'
import { collectMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import {
  deriveThinkingLabel,
  type MessageSegment,
  parseBlocks,
} from '@/app/workspace/[workspaceId]/home/components/message-content/parse-blocks'
import { resolveMessageCitations } from '@/app/workspace/[workspaceId]/home/components/message-content/resolve-citations'
import { indexSourcesByUrl } from '@/app/workspace/[workspaceId]/home/components/message-content/sources-by-url'
import { useToolResourceTitles } from '@/app/workspace/[workspaceId]/home/hooks/use-tool-resource-titles'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import type { AgentGroupItem } from './components'
import { AgentGroup, ChatContent, MessageSources, Options, PendingTagIndicator } from './components'
import { deriveMessagePhase, type MessagePhase } from './utils'

export {
  getOrchestratorMessageText,
  getOrchestratorMessageTextSegments,
  parseBlocks,
} from '@/app/workspace/[workspaceId]/home/components/message-content/parse-blocks'

/** Quiet period before the shimmer takes the slot back from streamed output. */
const STREAM_IDLE_DELAY_MS = 1_500
/**
 * The vertical extent (10px gap + 36px row) shared by the shimmer slot and the
 * actions row that replaces it at settle. The swap is only jump-free because
 * these are equal; changing one side without the other reintroduces a scroll
 * clamp at end of turn. (A stopped turn's stacked rows are exempt — their
 * extra height is glided-in growth, not a swap.)
 */
const TAIL_REGION_CLASSES = 'mt-[10px] flex h-[36px] items-center'

function getAgentGroupActivityKey(items: AgentGroupItem[]): string {
  return items
    .map((item) => {
      if (item.type === 'text') {
        return `text:${item.content.length}`
      }
      if (item.type === 'tool') {
        return [
          'tool',
          item.data.id,
          item.data.status,
          item.data.displayTitle,
          item.data.streamingArgs?.length ?? 0,
        ].join(':')
      }
      return [
        'agent',
        item.group.id,
        item.group.isDelegating ? 1 : 0,
        item.group.isOpen ? 1 : 0,
        getAgentGroupActivityKey(item.group.items),
      ].join(':')
    })
    .join('|')
}

/**
 * Compact identity for what the transcript is visibly rendering. Main-lane
 * reasoning and other suppressed blocks intentionally do not affect it, while
 * activity in every nested/parallel lane does.
 */
function getVisibleStreamActivityKey(segments: MessageSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === 'text') return `text:${segment.id}:${segment.content.length}`
      if (segment.type === 'options') {
        return `options:${segment.items.map((item) => `${item.id}:${item.label.length}`).join(',')}`
      }
      if (segment.type === 'stopped') return 'stopped'
      if (segment.type === 'task') {
        return `task:${segment.task.taskId}:${segment.task.status ?? 'pending'}`
      }
      return [
        'agent',
        segment.id,
        segment.isDelegating ? 1 : 0,
        segment.isOpen ? 1 : 0,
        getAgentGroupActivityKey(segment.items),
      ].join(':')
    })
    .join('||')
}

/**
 * Mirrors the segment resolution inside {@link MessageContent} so list renderers
 * can tell whether an assistant message has anything visible yet. Avoids treating
 * `contentBlocks: [{ type: 'text', content: '' }]` as "has content" — that briefly
 * made MessageContent return null while streaming and caused a double Thinking flash.
 */
export function assistantMessageHasRenderableContent(
  blocks: ContentBlock[],
  fallbackContent: string
): boolean {
  const parsed = blocks.length > 0 ? parseBlocks(blocks) : []
  const segments: MessageSegment[] =
    parsed.length > 0
      ? parsed
      : fallbackContent.trim()
        ? [{ type: 'text' as const, id: 'text-fallback', content: fallbackContent }]
        : []
  return segments.some(
    (segment) =>
      segment.type !== 'agent_group' ||
      Boolean(segment.error) ||
      segment.items.some(hasAgentGroupItemContent)
  )
}

/** The turn's live indicators, decided once by {@link getTurnLiveIndicators} for every lane. */
function getMessageLiveIndicators(
  segments: MessageSegment[],
  isStreaming: boolean,
  actionLayout: ReturnType<typeof useAssistantActionLayout>
): TurnLiveIndicators {
  return getTurnLiveIndicators(
    segments.flatMap((segment) => (segment.type === 'agent_group' ? [segment] : [])),
    isStreaming,
    actionLayout
  )
}

export function shouldSmoothTextSegment({
  isStreaming,
  segmentIndex,
  segmentCount,
}: {
  isStreaming: boolean
  segmentIndex: number
  segmentCount: number
}): boolean {
  return isStreaming && segmentIndex === segmentCount - 1
}

interface MessageContentProps {
  blocks: ContentBlock[]
  fallbackContent: string
  messageId?: string
  imageRequestId?: string
  requestMode?: 'agent' | 'assistant' | 'plan'
  isStreaming: boolean
  /**
   * True for the last message in the transcript. The last turn keeps a
   * fixed-height thinking slot at its bottom (see JSX) so the shimmer fades in
   * place without ever changing height.
   */
  isLast?: boolean
  /** Pending review controls own the tail until the user decides. */
  awaitingInteraction?: boolean
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  /** The user moved on without submitting this message's credential card. */
  credentialAbandoned?: boolean
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onPhaseChange?: (phase: MessagePhase) => void
  /**
   * The message's actions row (copy/thumbs). Rendered here, in the thinking
   * slot's position, so at settle the shimmer and the actions trade places in
   * one render — a single tiny reflow instead of a collapse the buttons ride
   * or a late mount the chase visibly scrolls to. The caller gates it on
   * content/question eligibility only; the settle timing is owned here.
   */
  actions?: ReactNode
}

function MessageContentInner({
  blocks,
  fallbackContent,
  messageId,
  imageRequestId,
  requestMode,
  isStreaming = false,
  isLast = false,
  awaitingInteraction = false,
  questionAnswers,
  credentialSubmission,
  credentialAbandoned,
  onOptionSelect,
  onQuestionDismiss,
  onPhaseChange,
  actions,
}: MessageContentProps) {
  const { onWorkspaceResourceSelect, onViewSources } = useChatSurface()
  const blockOverlayVersion = useCustomBlockOverlayVersion()
  const cited = useMemo(
    () => resolveMessageCitations(blocks, fallbackContent, requestMode === 'assistant'),
    [blocks, fallbackContent, requestMode]
  )
  const titledBlocks = useToolResourceTitles(cited.blocks)
  const linkSources = useMemo(() => indexSourcesByUrl(cited.sources), [cited.sources])
  const parsed = useMemo(
    () => (titledBlocks.length > 0 ? parseBlocks(titledBlocks, isStreaming) : []),
    [titledBlocks, blockOverlayVersion, isStreaming]
  )

  const [trailingRevealing, setTrailingRevealing] = useState(false)
  const handleTrailingRevealChange = useCallback((revealing: boolean) => {
    setTrailingRevealing(revealing)
  }, [])
  const [trailingStreamActivity, setTrailingStreamActivity] = useState(false)
  const handleTrailingStreamActivityChange = useCallback((active: boolean) => {
    setTrailingStreamActivity(active)
  }, [])
  const [trailingPendingTag, setTrailingPendingTag] = useState(false)
  const handleTrailingPendingTagChange = useCallback((pending: boolean) => {
    setTrailingPendingTag(pending)
  }, [])
  const [isStreamIdle, setIsStreamIdle] = useState(false)

  const segments = useMemo<MessageSegment[]>(
    () =>
      parsed.length > 0
        ? parsed
        : cited.fallbackContent?.trim()
          ? [{ type: 'text', id: 'text-fallback', content: cited.fallbackContent }]
          : [],
    [parsed, cited.fallbackContent]
  )
  /**
   * Collected from the segments that render, not the raw blocks: that is the
   * same text the inline chips come from, so the footer agrees with them — it
   * covers the fallback text of a block-less message and leaves out lane text
   * that `parseBlocks` folds into agent groups.
   */
  const sources = useMemo(
    () =>
      collectMessageSources(
        segments.flatMap((segment) => (segment.type === 'text' ? [segment.content] : []))
      ),
    [segments]
  )
  const visibleStreamActivityKey = getVisibleStreamActivityKey(segments)
  /** Decided once per parse, not on every idle-timer or text-reveal render. */
  const actionLayout = useAssistantActionLayout()
  const liveIndicators = useMemo(
    () => getMessageLiveIndicators(segments, isStreaming, actionLayout),
    [segments, isStreaming, actionLayout]
  )

  // Every visible stream update restarts the quiet-period clock. A layout
  // effect clears an already-visible shimmer before paint, so a chunk from any
  // parallel lane yields the slot to the arriving output without a stale flash.
  useLayoutEffect(() => {
    if (!isStreaming) {
      setIsStreamIdle(false)
      return
    }

    setIsStreamIdle(false)
    const timeout = setTimeout(() => setIsStreamIdle(true), STREAM_IDLE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [visibleStreamActivityKey, isStreaming])

  const lastSegment = segments[segments.length - 1]
  // The reveal tail is the last TEXT segment — a stopped block appends AFTER
  // the text that is still visibly draining, and treating the turn as settled
  // the moment it lands tears down the scroll machinery mid-reveal.
  const revealTailIndex =
    lastSegment?.type === 'stopped' && segments[segments.length - 2]?.type === 'text'
      ? segments.length - 2
      : lastSegment?.type === 'text'
        ? segments.length - 1
        : -1
  const isRevealing = revealTailIndex >= 0 && trailingRevealing
  const phase = deriveMessagePhase({ isStreaming, isRevealing })

  const onPhaseChangeRef = useRef(onPhaseChange)
  onPhaseChangeRef.current = onPhaseChange
  useEffect(() => {
    onPhaseChangeRef.current?.(phase)
  }, [phase])

  // The slot is the last message's own element, so it grows on send with the
  // row (no separate mount → no jump). Gated on phase, not isStreaming: the
  // trailing text keeps visually revealing on a timer after the network stream
  // closes, and collapsing under a still-growing reveal reads as the blob
  // winking out early while everything shifts.
  const thinkingExpanded =
    !awaitingInteraction && phase !== 'settled' && lastSegment?.type !== 'stopped'

  if (segments.length === 0 && !isLast) return null

  // A mid-stream special tag renders nothing until complete, so its bytes are a
  // wait, not output — the shimmer bridges it without the quiet-period delay.
  const thinkingLabel = deriveThinkingLabel(blocks)
  const hasActivityIndicator = ownsTurnWait(liveIndicators)
  const hasPendingAgents =
    isStreaming &&
    segments.some((segment) => segment.type === 'agent_group' && hasPendingAgentGroup(segment))
  const showShimmer =
    thinkingExpanded &&
    (segments.length === 0 ||
      trailingPendingTag ||
      (((hasPendingAgents && revealTailIndex < 0) || isStreamIdle) &&
        !trailingStreamActivity &&
        !hasActivityIndicator))

  const actionsRow = (
    <div className='flex items-center gap-0.5'>
      {actions}
      {sources.length > 0 && (
        <MessageSources
          sources={sources}
          onViewAll={
            messageId && onViewSources ? () => onViewSources(messageId, imageRequestId) : undefined
          }
        />
      )}
    </div>
  )

  return (
    <div>
      <div
        className={cn(
          '[&>:empty]:hidden [&>:has(~:not(:empty))]:mb-4',
          '[&>[data-chat-activity]:has(+[data-chat-activity],+:empty+[data-chat-activity])]:mb-2',
          '[&>[data-agent-group]:has(>div:last-child>div:last-child>[data-interaction-card]:last-child):has(~:not(:empty))]:mb-4'
        )}
      >
        {segments.map((segment, i) => {
          switch (segment.type) {
            case 'text':
              return (
                <ChatContent
                  key={segment.id}
                  content={segment.content}
                  messageId={messageId}
                  imageRequestId={imageRequestId}
                  requestMode={requestMode}
                  linkSources={linkSources}
                  isStreaming={shouldSmoothTextSegment({
                    isStreaming,
                    segmentIndex: i,
                    segmentCount: segments.length,
                  })}
                  questionAnswers={questionAnswers}
                  credentialSubmission={credentialSubmission}
                  credentialAbandoned={credentialAbandoned}
                  onOptionSelect={onOptionSelect}
                  onQuestionDismiss={onQuestionDismiss}
                  onWorkspaceResourceSelect={onWorkspaceResourceSelect}
                  onRevealStateChange={
                    i === revealTailIndex ? handleTrailingRevealChange : undefined
                  }
                  onStreamActivityChange={
                    i === revealTailIndex ? handleTrailingStreamActivityChange : undefined
                  }
                  onPendingTagChange={
                    i === revealTailIndex ? handleTrailingPendingTagChange : undefined
                  }
                />
              )
            case 'agent_group': {
              if (!segment.error && !segment.items.some(hasAgentGroupItemContent)) return null
              return (
                <div
                  key={segment.id}
                  data-agent-group
                  data-chat-activity
                  className={isStreaming ? 'animate-stream-fade-in' : undefined}
                >
                  <AgentGroup
                    activity={segment.activity}
                    liveIndicator={liveIndicators.byLane.get(segment.id) ?? null}
                    key={segment.id}
                    agentName={segment.agentName}
                    agentLabel={segment.agentLabel}
                    items={segment.items}
                    isDelegating={segment.isDelegating}
                    isStreaming={isStreaming}
                    isLaneOpen={segment.isOpen}
                    error={segment.error}
                  />
                </div>
              )
            }
            case 'options':
              return (
                <div
                  key={`options-${i}`}
                  className={isStreaming ? 'animate-stream-fade-in' : undefined}
                >
                  <Options items={segment.items} onSelect={onOptionSelect} />
                </div>
              )
            case 'task':
              return <WatchActivity key={`task-${segment.task.taskId}`} task={segment.task} />
            // The stopped row renders in the tail region below, in the
            // shimmer's place — a stop while the shimmer is visible must read
            // as an in-place replacement, not the shimmer vanishing from the
            // tail while a row mounts up here.
            case 'stopped':
              return null
          }
        })}
      </div>
      {thinkingExpanded && isLast ? (
        // Fixed-height placeholder for the NEXT piece of output: the shimmer
        // and arriving output trade places via opacity only, so mid-turn swaps
        // can't move layout. A sibling of the space-y stack (not a child), so
        // it carries no stray sibling margin.
        <div aria-hidden={!showShimmer} className={TAIL_REGION_CLASSES}>
          <div
            className={cn(
              'transition-opacity duration-200 ease-out',
              showShimmer ? 'opacity-100' : 'opacity-0'
            )}
          >
            <PendingTagIndicator label={thinkingLabel} />
          </div>
        </div>
      ) : // The settled tail takes the slot's place in the SAME render and at the
      // SAME extent (TAIL_REGION_CLASSES), so the swap is height-neutral by
      // construction — no reflow for the pinned scroller to absorb. A stopped
      // turn instead stacks compact natural rows (10px gaps, no 36px boxes):
      // its extra height is glided-in growth either way, so only the
      // shimmer-swap occupant needs the fixed extent.
      lastSegment?.type === 'stopped' ? (
        <>
          <div className='mt-[10px] flex items-center gap-[8px]'>
            <CircleStop className='size-[16px] shrink-0 text-[var(--text-icon)]' />
            <span className='text-[14px] text-[var(--text-body)]'>Stopped by user</span>
          </div>
          {actions && <div className='mt-[10px]'>{actionsRow}</div>}
        </>
      ) : (
        actions && <div className={TAIL_REGION_CLASSES}>{actionsRow}</div>
      )}
    </div>
  )
}

export const MessageContent = memo(MessageContentInner)
