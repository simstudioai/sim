'use client'

import { cn } from '@/lib/core/utils/cn'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

interface ResourceTabsProps {
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
}

/**
 * Horizontal tab bar for switching between mothership resources.
 * Mirrors the role of ResourceHeader in the Resource abstraction.
 */
export function ResourceTabs({ resources, activeId, onSelect }: ResourceTabsProps) {
  return (
    <div className='flex shrink-0 gap-[2px] overflow-x-auto border-[var(--border)] border-b px-[12px]'>
      {resources.map((resource) => (
        <button
          key={resource.id}
          type='button'
          onClick={() => onSelect(resource.id)}
          className={cn(
            'shrink-0 cursor-pointer border-b-[2px] px-[12px] py-[10px] text-[13px] transition-colors',
            activeId === resource.id
              ? 'border-[var(--text-primary)] font-medium text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          {resource.title}
        </button>
      ))}
    </div>
  )
}
