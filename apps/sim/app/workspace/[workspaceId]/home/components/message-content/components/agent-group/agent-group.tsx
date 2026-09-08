'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent, OverflowText } from '@sim/emcn'
import { ShimmerText } from '@/components/ui'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { Terminal as TerminalTool } from '@/lib/mothership/generated/tool-catalog-v1'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/mothership/tools/retired-tools'
import { readToolActivity } from '@/lib/mothership/tools/tool-activity'
import { getToolDisplayTitle, getToolStatusDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { useSmoothText } from '@/hooks/use-smooth-text'
import { type ToolCallData, ToolCallStatus } from '../../../../types'
import { getAgentIcon, isToolDone } from '../../utils'
import { CredentialDisplay } from '../special-tags'
import { renderInlineMarkdown } from './inline-markdown'
import { ToolCallItem } from './tool-call-item'

/**
 * A subagent group nested inside another agent's output. Carries the same shape
 * as a top-level group so {@link AgentGroup} can render it recursively, which is
 * how deterministic parent/child nesting (e.g. Deploy inside Workflow) is drawn.
 */
export interface NestedAgentGroup {
  error?: string
  id: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating: boolean
  isOpen: boolean
}

export type AgentGroupItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; data: ToolCallData }
  | { type: 'agent_group'; group: NestedAgentGroup }

interface AgentGroupProps {
  activity?: ToolActivity
  completedGroupCount?: number
  error?: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  /** The subagent lane is still open (no subagent_end yet) — i.e. actively running. */
  isLaneOpen?: boolean
}

function toolStatusTitle(tool: ToolCallData): string {
  return tool.displayTitle || getToolDisplayTitle(String(tool.toolName ?? ''), tool.params)
}

/** Only explicit intent updates rename a main group; nested agents own their own headings. */
function groupActivityTitle(items: AgentGroupItem[]): ToolActivity | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type !== 'tool') continue
    const tool = item.data
    const activity = readToolActivity(tool.params, tool.streamingArgs)
    if (activity?.title && activity.completedTitle) return activity
  }
  return undefined
}

/**
 * Every tool in a group, in stream order, including those run by nested
 * agents. A parent's status line speaks for the whole subtree it delegated,
 * so a grandchild's work is what surfaces while the parent itself waits.
 */
function collectGroupTools(items: AgentGroupItem[]): ToolCallData[] {
  const tools: ToolCallData[] = []
  const walk = (list: AgentGroupItem[]) => {
    for (const item of list) {
      if (item.type === 'tool') tools.push(item.data)
      else if (item.type === 'agent_group') walk(item.group.items)
    }
  }
  walk(items)
  return tools
}

/** Blocking decisions must stay visible even when the surrounding log is collapsed. */
function hasBlockingInteraction(items: AgentGroupItem[]): boolean {
  return items.some((item) => {
    if (item.type === 'tool') {
      return (
        item.data.status === ToolCallStatus.awaiting_approval ||
        (item.data.toolName === TerminalTool.id &&
          item.data.status === ToolCallStatus.executing &&
          item.data.params?.operation === 'handoff')
      )
    }
    return item.type === 'agent_group' ? hasBlockingInteraction(item.group.items) : false
  })
}

interface ActiveBrowserTakeover {
  id: string
  reason: string
}

/** Returns this group's own active browser hand-back, if any. */
function getActiveBrowserTakeover(items: AgentGroupItem[]): ActiveBrowserTakeover | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type !== 'tool') continue
    if (
      item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID &&
      item.data.status === ToolCallStatus.executing
    ) {
      const reason = item.data.params?.reason
      return {
        id: item.data.id,
        reason: typeof reason === 'string' ? reason.trim() : '',
      }
    }
    // Browser-agent tools are serialized. Once a newer tool exists, an older
    // executing takeover is stale and must not keep a question on screen.
    return null
  }
  return null
}

/** True when a nested group owns a browser hand-back question. */
function hasNestedBrowserTakeover(items: AgentGroupItem[]): boolean {
  return items.some(
    (item) =>
      item.type === 'agent_group' &&
      item.group.isOpen &&
      (getActiveBrowserTakeover(item.group.items) !== null ||
        hasNestedBrowserTakeover(item.group.items))
  )
}

export function isAgentGroupResolved(items: AgentGroupItem[]): boolean {
  let hasWork = false
  for (const item of items) {
    if (item.type === 'tool') {
      hasWork = true
      if (!isToolDone(item.data.status)) return false
    } else if (item.type === 'agent_group') {
      hasWork = true
      if (item.group.isDelegating || !isAgentGroupResolved(item.group.items)) return false
    }
  }
  return hasWork
}

export function AgentGroup({
  agentName,
  agentLabel,
  items,
  isDelegating = false,
  isStreaming = false,
  isLaneOpen = false,
  activity: groupActivity,
  completedGroupCount = 0,
  error,
}: AgentGroupProps) {
  const isMainAgent = agentName === 'mothership'
  /** Main groups summarize their tool log; subagents retain their named live status. */
  const status = useMemo(() => {
    if (!isMainAgent && !isLaneOpen) return undefined
    const tools = collectGroupTools(items)
    const running = tools.filter((tool) => tool.status === ToolCallStatus.executing)
    const latest = running.length
      ? running.reduce((newest, tool) =>
          (tool.startedAt ?? 0) >= (newest.startedAt ?? 0) ? tool : newest
        )
      : tools.at(-1)
    if (!latest) return undefined
    const activity = isMainAgent ? (groupActivity ?? groupActivityTitle(items)) : undefined
    const initialCall = tools[0]
    const generatingFirstCall =
      tools.length === 1 &&
      initialCall?.status === ToolCallStatus.executing &&
      (initialCall.toolName === 'sim_cli' || initialCall.toolName === 'run_code') &&
      Object.keys(initialCall.params ?? {}).length === 0
    const activityTools =
      completedGroupCount > 1 && activity
        ? tools.filter(
            (tool) => readToolActivity(tool.params, tool.streamingArgs)?.id === activity.id
          )
        : tools
    const failed = activityTools.find(
      (tool) => tool.status !== ToolCallStatus.success && isToolDone(tool.status)
    )
    const activityComplete = !failed && isAgentGroupResolved(items)
    const mainTitle =
      activity?.title && activity.completedTitle
        ? activityComplete
          ? activity.completedTitle
          : activity.title
        : generatingFirstCall
          ? 'Working…'
          : toolStatusTitle(latest)
    return {
      title: isMainAgent
        ? getToolStatusDisplayTitle(
            mainTitle,
            activity
              ? running.length > 0
                ? 'executing'
                : failed
                  ? failed.status === 'error' || failed.status === 'rejected'
                    ? 'error'
                    : 'cancelled'
                  : 'executing'
              : latest.status,
            latest.toolName
          )
        : toolStatusTitle(latest),
      additionalCount: Math.max(0, (isMainAgent ? completedGroupCount : 0) - 1, running.length - 1),
    }
  }, [isLaneOpen, isMainAgent, items, groupActivity, completedGroupCount])
  const AgentIcon = getAgentIcon(agentName)
  const headerText = error
    ? isMainAgent
      ? 'Tool call failed'
      : `${agentLabel} — Failed`
    : isMainAgent
      ? (status?.title ?? 'Working')
      : status
        ? `${agentLabel} — ${status.title}`
        : agentLabel
  const hasItems = items.length > 0
  const resolved = isAgentGroupResolved(items)
  const browserAgentAvailable = isBrowserAgentAvailable()
  const activeBrowserTakeover =
    browserAgentAvailable && isLaneOpen ? getActiveBrowserTakeover(items) : null
  const nestedBrowserTakeover = browserAgentAvailable && hasNestedBrowserTakeover(items)
  const isWorking =
    !activeBrowserTakeover &&
    ((isDelegating && !resolved) || (isStreaming && isLaneOpen && (!isMainAgent || !resolved)))

  /** Keep every log collapsed until opened, except for blocking user interactions. */
  const [manualExpanded, setManualExpanded] = useState(false)
  const [expandedTakeoverId, setExpandedTakeoverId] = useState<string | null>(null)
  // An outstanding permission prompt overrides a manual collapse: the turn
  // cannot proceed until it is answered, so hiding it would deadlock the chat
  // with nothing on screen to explain why.
  const expanded =
    hasBlockingInteraction(items) ||
    nestedBrowserTakeover ||
    (activeBrowserTakeover ? expandedTakeoverId === activeBrowserTakeover.id : manualExpanded)

  const toggleExpanded = () => {
    if (activeBrowserTakeover) {
      setExpandedTakeoverId(expanded ? null : activeBrowserTakeover.id)
      return
    }
    setManualExpanded(!expanded)
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {hasItems ? (
        <button
          type='button'
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className='group/agent flex w-full min-w-0 cursor-pointer items-center gap-2 text-left'
        >
          {!isMainAgent && (
            <div className='flex size-[16px] shrink-0 items-center justify-center'>
              <AgentIcon className='size-[16px] text-[var(--text-icon)]' />
            </div>
          )}
          {isWorking ? (
            <ShimmerText className='min-w-0 truncate text-sm'>{headerText}</ShimmerText>
          ) : (
            <OverflowText label={headerText} className='text-[var(--text-body)] text-sm' />
          )}
          {status && status.additionalCount > 0 && (
            <span className='shrink-0 text-[var(--text-secondary)] text-sm'>
              {' + '}
              {status.additionalCount}
            </span>
          )}
          <ChevronDown
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-icon)] opacity-0 transition-[transform,opacity] duration-150 group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <div className='flex min-w-0 items-center gap-2'>
          {!isMainAgent && (
            <div className='flex size-[16px] shrink-0 items-center justify-center'>
              <AgentIcon className='size-[16px] text-[var(--text-icon)]' />
            </div>
          )}
          {isWorking ? (
            <ShimmerText className='min-w-0 truncate text-sm'>{headerText}</ShimmerText>
          ) : (
            <OverflowText label={headerText} className='text-[var(--text-body)] text-sm' />
          )}
        </div>
      )}
      {error && <p className='pl-6 text-[var(--text-error)] text-caption'>{error}</p>}
      {hasItems && (
        <Expandable expanded={expanded}>
          <ExpandableContent>
            <BoundedViewport isStreaming={isStreaming} unbounded={nestedBrowserTakeover}>
              <div className='flex flex-col gap-1.5 py-0.5'>
                {items.map((item, idx) => {
                  if (item.type === 'tool') {
                    return (
                      <ToolCallItem
                        key={item.data.id}
                        toolCallId={item.data.id}
                        toolName={item.data.toolName}
                        displayTitle={item.data.displayTitle}
                        status={item.data.status}
                        params={item.data.params}
                        result={item.data.result}
                        streamingArgs={item.data.streamingArgs}
                        startedAt={item.data.startedAt}
                      />
                    )
                  }
                  if (item.type === 'agent_group') {
                    return (
                      <div key={item.group.id} className='pl-6'>
                        <AgentGroup
                          agentName={item.group.agentName}
                          agentLabel={item.group.agentLabel}
                          items={item.group.items}
                          isDelegating={item.group.isDelegating}
                          isStreaming={isStreaming}
                          isLaneOpen={item.group.isOpen}
                          error={item.group.error}
                        />
                      </div>
                    )
                  }
                  return (
                    <NarrationText
                      key={`text-${idx}`}
                      content={item.content}
                      isStreaming={isStreaming && idx === items.length - 1}
                    />
                  )
                })}
              </div>
            </BoundedViewport>
          </ExpandableContent>
        </Expandable>
      )}
      {activeBrowserTakeover && (
        <div key={activeBrowserTakeover.id} className='animate-stream-fade-in'>
          <CredentialDisplay
            data={[{ type: 'browser_takeover', name: activeBrowserTakeover.reason }]}
          />
        </div>
      )}
    </div>
  )
}

interface NarrationTextProps {
  content: string
  /** This row is the group's live tail — pace its reveal like top-level text. */
  isStreaming: boolean
}

/**
 * A narration row inside an agent group. The live tail row is
 * paced with {@link useSmoothText} so streamed chunks reveal word-by-word
 * instead of popping in, matching the top-level text treatment.
 */
function NarrationText({ content, isStreaming }: NarrationTextProps) {
  const revealed = useSmoothText(content, isStreaming)

  return (
    <span className='pl-6 text-[13px] text-[var(--text-muted)] leading-[18px]'>
      {renderInlineMarkdown(revealed.trim())}
    </span>
  )
}

interface BoundedViewportProps {
  children: React.ReactNode
  isStreaming: boolean
  /** A nested blocking interaction must not be clipped by this ancestor's log viewport. */
  unbounded?: boolean
}

const BOTTOM_STICK_THRESHOLD_PX = 8

function BoundedViewport({ children, isStreaming, unbounded = false }: BoundedViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const prevScrollTopRef = useRef(0)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
    if (unbounded) {
      stickToBottomRef.current = true
      return
    }
    const el = ref.current
    if (!el) return
    // Upward user input detaches auto-stick; a downward scroll reaching the
    // bottom re-attaches it (a small upward flick can't re-stick itself).
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottomRef.current = false
    }
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance < BOTTOM_STICK_THRESHOLD_PX && el.scrollTop > prevScrollTopRef.current) {
        stickToBottomRef.current = true
      }
      prevScrollTopRef.current = el.scrollTop
    }
    el.addEventListener('wheel', handleWheel, { passive: true })
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('scroll', handleScroll)
    }
  }, [unbounded])

  useLayoutEffect(() => {
    const el = ref.current
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (unbounded) {
      setHasOverflow(false)
      return
    }
    if (el) {
      const next = el.scrollHeight > el.clientHeight
      setHasOverflow((prev) => (prev === next ? prev : next))
    }
    if (!isStreaming) return
    const tick = () => {
      const node = ref.current
      if (!node || !stickToBottomRef.current) {
        rafRef.current = null
        return
      }
      const target = node.scrollHeight - node.clientHeight
      const gap = target - node.scrollTop
      if (gap < 1) {
        rafRef.current = null
        return
      }
      node.scrollTop = node.scrollTop + Math.max(1, gap * 0.18)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  })

  return (
    <div className='relative'>
      <div
        ref={ref}
        className={cn(
          'pr-2',
          !unbounded && 'scrollbar-hide max-h-[110px] overflow-y-auto',
          hasOverflow && 'py-1'
        )}
      >
        {children}
      </div>
      {!unbounded && hasOverflow && (
        <>
          <div className='pointer-events-none absolute top-0 right-2 left-0 h-3 bg-linear-to-b from-[var(--bg)] to-transparent' />
          <div className='pointer-events-none absolute right-2 bottom-0 left-0 h-3 bg-linear-to-t from-[var(--bg)] to-transparent' />
        </>
      )}
    </div>
  )
}
