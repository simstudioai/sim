'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ToolCallStatus } from '../../../../types'
import { getAgentIcon } from '../../utils'
import { ToolCallItem } from './tool-call-item'

interface ToolCallData {
  id: string
  toolName: string
  displayTitle: string
  status: ToolCallStatus
}

interface AgentGroupProps {
  agentName: string
  agentLabel: string
  tools: ToolCallData[]
  autoCollapse?: boolean
}

const FADE_MS = 300

export function AgentGroup({
  agentName,
  agentLabel,
  tools,
  autoCollapse = false,
}: AgentGroupProps) {
  const AgentIcon = getAgentIcon(agentName)
  const hasTools = tools.length > 0
  const allDone = hasTools && tools.every((t) => t.status === 'success' || t.status === 'error')

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
    <div className='flex flex-col gap-1.5'>
      <button
        type='button'
        onClick={hasTools ? () => setExpanded((prev) => !prev) : undefined}
        className={cn('flex items-center gap-[8px]', hasTools && 'cursor-pointer')}
      >
        <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
          <AgentIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        </div>
        <span className='font-[var(--sidebar-font-weight)] text-[14px] text-[var(--text-body)]'>
          {agentLabel}
        </span>
        {hasTools && (
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        )}
      </button>
      {hasTools && mounted && (
        <div
          className={cn(
            'flex flex-col gap-1.5 transition-opacity duration-300 ease-out',
            expanded ? 'opacity-100' : 'opacity-0'
          )}
        >
          {tools.map((tool) => (
            <ToolCallItem
              key={tool.id}
              toolName={tool.toolName}
              displayTitle={tool.displayTitle}
              status={tool.status}
            />
          ))}
        </div>
      )}
    </div>
  )
}
