'use client'

import { Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { MeshAgent } from '@/hooks/queries/mesh'

interface AgentAvatarProps {
  agent: MeshAgent
  size?: 'sm' | 'md'
}

/**
 * Colored circle avatar for a mesh agent, showing the first letter of its name.
 */
export function AgentAvatar({ agent, size = 'sm' }: AgentAvatarProps) {
  const sizeClasses = size === 'sm' ? 'h-[22px] w-[22px] text-[10px]' : 'h-[28px] w-[28px] text-[12px]'

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
            sizeClasses
          )}
          style={{ backgroundColor: agent.color || '#6366f1' }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <p>
          {agent.name}
          <span className='ml-[4px] text-[var(--text-subtle)]'>({agent.node})</span>
        </p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

interface AgentAvatarGroupProps {
  agents: MeshAgent[]
  max?: number
}

/**
 * Overlapping avatar group showing participating agents.
 */
export function AgentAvatarGroup({ agents, max = 4 }: AgentAvatarGroupProps) {
  const visible = agents.slice(0, max)
  const remaining = agents.length - max

  return (
    <div className='flex items-center'>
      <div className='flex -space-x-[6px]'>
        {visible.map((agent) => (
          <AgentAvatar key={agent.id} agent={agent} />
        ))}
      </div>
      {remaining > 0 && (
        <span className='ml-[6px] font-medium text-[11px] text-[var(--text-tertiary)]'>
          +{remaining}
        </span>
      )}
    </div>
  )
}
