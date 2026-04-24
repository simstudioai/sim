'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Expandable, ExpandableContent, PillsRing } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ToolCallData } from '../../../../types'
import { getAgentIcon } from '../../utils'
import { ToolCallItem } from './tool-call-item'

export type AgentGroupItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; data: ToolCallData }

interface AgentGroupProps {
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  autoCollapse?: boolean
  defaultExpanded?: boolean
}

function isToolDone(status: ToolCallData['status']): boolean {
  return (
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'rejected'
  )
}

export function AgentGroup({
  agentName,
  agentLabel,
  items,
  isDelegating = false,
  isStreaming = false,
  autoCollapse = false,
  defaultExpanded = false,
}: AgentGroupProps) {
  const AgentIcon = getAgentIcon(agentName)
  const hasItems = items.length > 0
  const toolItems = items.filter(
    (item): item is Extract<AgentGroupItem, { type: 'tool' }> => item.type === 'tool'
  )
  const allDone = toolItems.length > 0 && toolItems.every((t) => isToolDone(t.data.status))

  const [expanded, setExpanded] = useState(defaultExpanded || !allDone)
  const didAutoCollapseRef = useRef(allDone)
  const wasAutoExpandedRef = useRef(defaultExpanded)

  useEffect(() => {
    if (defaultExpanded) {
      wasAutoExpandedRef.current = true
      setExpanded(true)
      return
    }

    if (wasAutoExpandedRef.current && allDone) {
      wasAutoExpandedRef.current = false
      setExpanded(false)
    }
  }, [defaultExpanded, allDone])

  useEffect(() => {
    if (!autoCollapse || didAutoCollapseRef.current) return
    didAutoCollapseRef.current = true
    setExpanded(false)
  }, [autoCollapse])

  return (
    <div className='flex flex-col gap-1.5'>
      {hasItems ? (
        <button
          type='button'
          onClick={() => {
            wasAutoExpandedRef.current = false
            setExpanded((prev) => !prev)
          }}
          className='flex cursor-pointer items-center gap-2'
        >
          <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
            {isDelegating ? (
              <PillsRing className='h-[15px] w-[15px] text-[var(--text-icon)]' animate />
            ) : (
              <AgentIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            )}
          </div>
          <span className='font-base text-[var(--text-body)] text-sm'>{agentLabel}</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <div className='flex items-center gap-2'>
          <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
            {isDelegating ? (
              <PillsRing className='h-[15px] w-[15px] text-[var(--text-icon)]' animate />
            ) : (
              <AgentIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            )}
          </div>
          <span className='font-base text-[var(--text-body)] text-sm'>{agentLabel}</span>
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
                        streamingArgs={item.data.streamingArgs}
                      />
                    )
                  }
                  return (
                    <span
                      key={`text-${idx}`}
                      className='pl-6 font-base text-[13px] text-[var(--text-secondary)] leading-[18px] opacity-60'
                    >
                      {item.content.trim()}
                    </span>
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

interface BoundedViewportProps {
  children: React.ReactNode
  isStreaming: boolean
}

const BOTTOM_STICK_THRESHOLD_PX = 8

function BoundedViewport({ children, isStreaming }: BoundedViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Any upward user input detaches auto-stick. A subsequent scroll-to-bottom
    // (wheel back down or dragging scrollbar) re-attaches it.
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottomRef.current = false
    }
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance < BOTTOM_STICK_THRESHOLD_PX) stickToBottomRef.current = true
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
      <div ref={ref} className={cn('max-h-[110px] overflow-y-auto pr-2', hasOverflow && 'py-1')}>
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
