'use client'

import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent, OverflowText } from '@sim/emcn'
import { ShimmerText } from '@/components/ui'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/copilot/tools/retired-tools'
import { renderInlineMarkdown } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/inline-markdown'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import {
  getAgentIcon,
  isToolDone,
} from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { useSmoothText } from '@/hooks/use-smooth-text'

/**
 * A subagent group nested inside another agent's output. Carries the same shape
 * as a top-level group so {@link AgentGroupView} can render it recursively, which is
 * how deterministic parent/child nesting (e.g. Deploy inside Workflow) is drawn.
 */
export interface NestedAgentGroup {
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

export interface AgentGroupProps {
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  /** This group is the latest section in its parent sequence (drives collapse). */
  isCurrentSection?: boolean
  /** The subagent lane is still open (no subagent_end yet) — i.e. actively running. */
  isLaneOpen?: boolean
  /** Opens the group on first render without changing production's automatic collapse rules. */
  defaultExpanded?: boolean
  /** Keeps the activity viewport anchored at the top while new rows stream in. */
  autoScrollActivity?: boolean
}

function toolStatusTitle(tool: ToolCallData): string {
  return tool.displayTitle || String(tool.toolName ?? '')
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

/** True when any row in this group (or a nested one) is waiting on a permission decision. */
function hasAwaitingApproval(items: AgentGroupItem[]): boolean {
  return items.some((item) => {
    if (item.type === 'tool') return item.data.status === ToolCallStatus.awaiting_approval
    // Text rows carry no tool calls, so only nested groups need recursing into.
    return item.type === 'agent_group' ? hasAwaitingApproval(item.group.items) : false
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

interface AgentGroupViewProps extends AgentGroupProps {
  /** Supplies tool behavior without coupling the group layout to the block registry. */
  ToolCallComponent: ComponentType<ToolCallItemProps>
  renderBrowserTakeover?: (reason: string) => ReactNode
}

export function AgentGroupView({
  agentName,
  agentLabel,
  items,
  isDelegating = false,
  isStreaming = false,
  isCurrentSection = false,
  isLaneOpen = false,
  defaultExpanded = false,
  autoScrollActivity = true,
  ToolCallComponent,
  renderBrowserTakeover,
}: AgentGroupViewProps) {
  const AgentIcon = getAgentIcon(agentName)
  const isMainAgent = agentName === 'mothership'
  // Collapsed status line: the latest tool call, always in its RUNNING
  // phrasing — it never flips to the completed rewrite (that lives in the
  // expanded log). Work delegated further down bubbles up, so a group whose
  // own turn is idle still narrates what its nested agent is doing rather
  // than freezing on its last own tool. With several tools running at any
  // depth, the most recently started wins and the rest become "+ n"; between
  // rounds the last tool's title stays frozen; a closed lane shows the bare
  // name.
  const status = useMemo(() => {
    if (isMainAgent || !isLaneOpen) return undefined
    const tools = collectGroupTools(items)
    const running = tools.filter((tool) => tool.status === ToolCallStatus.executing)
    if (running.length > 0) {
      const latest = running.reduce((newest, tool) =>
        (tool.startedAt ?? 0) >= (newest.startedAt ?? 0) ? tool : newest
      )
      const title = toolStatusTitle(latest)
      return running.length > 1 ? `${title} + ${running.length - 1}` : title
    }
    const last = tools.at(-1)
    return last ? toolStatusTitle(last) : undefined
  }, [isLaneOpen, isMainAgent, items])
  const headerText = status ? `${agentLabel} — ${status}` : agentLabel
  const hasItems = items.length > 0
  const resolved = isAgentGroupResolved(items)
  const browserAgentAvailable = isBrowserAgentAvailable()
  const activeBrowserTakeover =
    browserAgentAvailable && isLaneOpen ? getActiveBrowserTakeover(items) : null
  const nestedBrowserTakeover = browserAgentAvailable && hasNestedBrowserTakeover(items)
  const isWorking =
    !activeBrowserTakeover && ((isDelegating && !resolved) || (isStreaming && isLaneOpen))

  // SUBAGENT groups never auto-expand: the collapsed row IS the live view —
  // label plus latest running tool title. Expanding is a deliberate user
  // action; only a pending permission prompt or a browser hand-back forces
  // one open. The MAIN lane ("Sim") is not a delegation card: its narration
  // and tool calls are the turn itself, so it keeps the original live-expand
  // behavior (open while streaming/current, settles when superseded).
  const autoExpanded = isMainAgent && isStreaming && (isCurrentSection || isLaneOpen || !resolved)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(
    defaultExpanded ? true : null
  )
  const [expandedTakeoverId, setExpandedTakeoverId] = useState<string | null>(null)
  // An outstanding permission prompt overrides a manual collapse: the turn
  // cannot proceed until it is answered, so hiding it would deadlock the chat
  // with nothing on screen to explain why.
  const expanded =
    hasAwaitingApproval(items) ||
    nestedBrowserTakeover ||
    (activeBrowserTakeover
      ? expandedTakeoverId === activeBrowserTakeover.id
      : (manualExpanded ?? autoExpanded))

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
          className='group/agent flex w-full min-w-0 cursor-pointer items-center gap-2 text-left'
        >
          <div className='flex size-[16px] shrink-0 items-center justify-center'>
            <AgentIcon className='size-[16px] text-[var(--text-icon)]' />
          </div>
          {isWorking ? (
            <ShimmerText className='min-w-0 truncate text-sm'>{headerText}</ShimmerText>
          ) : (
            <OverflowText label={headerText} className='text-[var(--text-body)] text-sm' />
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
          <div className='flex size-[16px] shrink-0 items-center justify-center'>
            <AgentIcon className='size-[16px] text-[var(--text-icon)]' />
          </div>
          {isWorking ? (
            <ShimmerText className='min-w-0 truncate text-sm'>{headerText}</ShimmerText>
          ) : (
            <OverflowText label={headerText} className='text-[var(--text-body)] text-sm' />
          )}
        </div>
      )}
      {hasItems && (
        <Expandable expanded={expanded}>
          <ExpandableContent>
            <BoundedViewport
              isStreaming={isStreaming && autoScrollActivity}
              unbounded={nestedBrowserTakeover}
            >
              <div className='flex flex-col gap-1.5 py-0.5'>
                {items.map((item, idx) => {
                  if (item.type === 'tool') {
                    return (
                      <ToolCallComponent
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
                        <AgentGroupView
                          ToolCallComponent={ToolCallComponent}
                          renderBrowserTakeover={renderBrowserTakeover}
                          agentName={item.group.agentName}
                          agentLabel={item.group.agentLabel}
                          items={item.group.items}
                          isDelegating={item.group.isDelegating}
                          isStreaming={isStreaming}
                          isCurrentSection={idx === items.length - 1}
                          isLaneOpen={item.group.isOpen}
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
          {renderBrowserTakeover?.(activeBrowserTakeover.reason)}
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
