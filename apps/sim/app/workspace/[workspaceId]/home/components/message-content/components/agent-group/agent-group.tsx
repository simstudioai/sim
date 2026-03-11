'use client'

import { useState } from 'react'
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
}

export function AgentGroup({ agentName, agentLabel, tools }: AgentGroupProps) {
  const AgentIcon = getAgentIcon(agentName)
  const [expanded, setExpanded] = useState(true)
  const hasTools = tools.length > 0

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
      {hasTools && expanded && (
        <div className='flex flex-col gap-1.5'>
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
