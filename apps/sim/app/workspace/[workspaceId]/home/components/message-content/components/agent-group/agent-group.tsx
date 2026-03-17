'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/components/emcn'
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
  autoCollapse?: boolean
}

const FADE_MS = 300

export function AgentGroup({
  agentName,
  agentLabel,
  items,
  autoCollapse = false,
}: AgentGroupProps) {
  const AgentIcon = getAgentIcon(agentName)
  const hasItems = items.length > 0
  const toolItems = items.filter(
    (item): item is Extract<AgentGroupItem, { type: 'tool' }> => item.type === 'tool'
  )
  const allDone =
    toolItems.length > 0 &&
    toolItems.every(
      (t) =>
        t.data.status === 'success' || t.data.status === 'error' || t.data.status === 'cancelled'
    )

  const [expanded, setExpanded] = useState(!allDone)
  const [mounted, setMounted] = useState(!allDone)
  const didAutoCollapseRef = useRef(allDone)

  useEffect(() => {
    if (!autoCollapse || didAutoCollapseRef.current) return
    didAutoCollapseRef.current = true
    setExpanded(false)
  }, [autoCollapse])

  useEffect(() => {
    if (expanded) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(timer)
  }, [expanded])

  return (
    <div className='flex flex-col gap-[6px]'>
      {hasItems ? (
        <button
          type='button'
          onClick={() => setExpanded((prev) => !prev)}
          className='flex cursor-pointer items-center gap-[8px]'
        >
          <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
            <AgentIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </div>
          <span className='font-base text-[14px] text-[var(--text-body)]'>{agentLabel}</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <div className='flex items-center gap-[8px]'>
          <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
            <AgentIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </div>
          <span className='font-base text-[14px] text-[var(--text-body)]'>{agentLabel}</span>
        </div>
      )}
      {hasItems && mounted && (
        <div
          className={cn(
            'flex flex-col gap-[6px] transition-opacity duration-300 ease-out',
            expanded ? 'opacity-100' : 'opacity-0'
          )}
        >
          {items.map((item, idx) =>
            item.type === 'tool' ? (
              <ToolCallItem
                key={item.data.id}
                toolName={item.data.toolName}
                displayTitle={item.data.displayTitle}
                status={item.data.status}
                result={item.data.result}
              />
            ) : (
              <span
                key={`text-${idx}`}
                className='pl-[24px] font-base text-[13px] text-[var(--text-secondary)]'
              >
                {item.content.trim()}
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
}
