'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent } from '@sim/emcn'
import { EvalStatusIndicator, ShimmerText } from '@/components/ui'
import { useSmoothText } from '@/hooks/use-smooth-text'
import type { ToolCallData } from '../../../../types'
import { getAgentIcon, isToolDone } from '../../utils'
import { renderInlineMarkdown } from './inline-markdown'
import { ToolCallItem } from './tool-call-item'

/**
 * A subagent group nested inside another agent's output. Carries the same shape
 * as a top-level group so {@link AgentGroup} can render it recursively, which is
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

interface AgentGroupProps {
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  /** This group is the latest section in its parent sequence (drives collapse). */
  isCurrentSection?: boolean
  /** The subagent lane is still open (no subagent_end yet) — i.e. actively running. */
  isLaneOpen?: boolean
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

interface AgentGroupIconProps {
  agentName: string
}

function AgentGroupIcon({ agentName }: AgentGroupIconProps) {
  if (agentName === 'eval') {
    return <EvalStatusIndicator status='progress' progressMode='squeezed' decorative size={16} />
  }

  const Icon = getAgentIcon(agentName)
  return <Icon className='size-[16px] text-[var(--text-icon)]' />
}

export function AgentGroup({
  agentName,
  agentLabel,
  items,
  isDelegating = false,
  isStreaming = false,
  isCurrentSection = false,
  isLaneOpen = false,
}: AgentGroupProps) {
  const hasItems = items.length > 0
  const resolved = isAgentGroupResolved(items)
  const isWorking = (isDelegating && !resolved) || (isStreaming && isLaneOpen)

  // Expand while the turn is live and any of: the lane is open (the subagent is
  // actively running), this is the current/latest section, or there is unresolved
  // work. A finished group stays open until the NEXT section starts (it is no
  // longer the latest), instead of collapsing the instant its own work resolves.
  // Keying "still running" off the lane-open signal (not `resolved` alone) avoids
  // a collapse/reopen flicker on parallel siblings: a subagent's tools all
  // momentarily read "done" in the gap between its last search and its `respond`
  // ("Gathering thoughts") tool, transiently flipping `resolved` true; the open
  // lane bridges that gap so the row never collapses mid-run. The turn ending
  // (isStreaming false) collapses everything; a manual toggle pins the choice.
  const autoExpanded = isStreaming && (isCurrentSection || isLaneOpen || !resolved)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const expanded = manualExpanded ?? autoExpanded

  return (
    <div className='flex flex-col gap-1.5'>
      {hasItems ? (
        <button
          type='button'
          onClick={() => setManualExpanded(!expanded)}
          className='group/agent flex cursor-pointer items-center gap-2'
        >
          <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
            <AgentGroupIcon agentName={agentName} />
          </div>
          {isWorking ? (
            <ShimmerText className='text-sm'>{agentLabel}</ShimmerText>
          ) : (
            <span className='text-[var(--text-body)] text-sm'>{agentLabel}</span>
          )}
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] opacity-0 transition-[transform,opacity] duration-150 group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <div className='flex items-center gap-2'>
          <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
            <AgentGroupIcon agentName={agentName} />
          </div>
          {isWorking ? (
            <ShimmerText className='text-sm'>{agentLabel}</ShimmerText>
          ) : (
            <span className='text-[var(--text-body)] text-sm'>{agentLabel}</span>
          )}
        </div>
      )}
      {hasItems && (
        <Expandable expanded={expanded}>
          <ExpandableContent>
            <BoundedViewport isStreaming={isStreaming}>
              <div className='flex flex-col gap-1.5 py-0.5'>
                {items.map((item, idx) => {
                  if (item.type === 'tool') {
                    return (
                      <ToolCallItem
                        key={item.data.id}
                        toolName={item.data.toolName}
                        displayTitle={item.data.displayTitle}
                        status={item.data.status}
                        params={item.data.params}
                        streamingArgs={item.data.streamingArgs}
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
}

const BOTTOM_STICK_THRESHOLD_PX = 8

function BoundedViewport({ children, isStreaming }: BoundedViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const prevScrollTopRef = useRef(0)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
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
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      const next = el.scrollHeight > el.clientHeight
      setHasOverflow((prev) => (prev === next ? prev : next))
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
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
        className={cn('scrollbar-hide max-h-[110px] overflow-y-auto pr-2', hasOverflow && 'py-1')}
      >
        {children}
      </div>
      {hasOverflow && (
        <>
          <div className='pointer-events-none absolute top-0 right-2 left-0 h-3 bg-gradient-to-b from-[var(--bg)] to-transparent' />
          <div className='pointer-events-none absolute right-2 bottom-0 left-0 h-3 bg-gradient-to-t from-[var(--bg)] to-transparent' />
        </>
      )}
    </div>
  )
}
