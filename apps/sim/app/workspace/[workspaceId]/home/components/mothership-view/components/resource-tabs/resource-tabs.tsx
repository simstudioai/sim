'use client'

import type { ElementType } from 'react'
import { Button } from '@/components/emcn'
import { PanelLeft, Table as TableIcon } from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

interface ResourceTabsProps {
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
  onCollapse: () => void
}

const RESOURCE_ICONS: Record<Exclude<MothershipResourceType, 'file'>, ElementType> = {
  table: TableIcon,
  workflow: WorkflowIcon,
}

function getResourceIcon(resource: MothershipResource): ElementType {
  if (resource.type === 'file') {
    return getDocumentIcon('', resource.title)
  }
  return RESOURCE_ICONS[resource.type]
}

/**
 * Horizontal tab bar for switching between mothership resources.
 * Renders each resource as a subtle Button matching ResourceHeader actions.
 */
export function ResourceTabs({ resources, activeId, onSelect, onCollapse }: ResourceTabsProps) {
  return (
    <div className='flex shrink-0 items-center gap-[6px] overflow-x-auto border-[var(--border)] border-b px-[16px] py-[8.5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      <Button
        variant='subtle'
        onClick={onCollapse}
        className='shrink-0 bg-transparent px-[8px] py-[4px] text-[12px]'
        aria-label='Collapse resource view'
      >
        <PanelLeft className='h-[16px] w-[16px] text-[var(--text-icon)]' />
      </Button>
      {resources.map((resource) => {
        const Icon = getResourceIcon(resource)
        const isActive = activeId === resource.id

        return (
          <Button
            key={resource.id}
            variant='subtle'
            onClick={() => onSelect(resource.id)}
            className={cn(
              'shrink-0 bg-transparent px-[8px] py-[4px] text-[12px]',
              isActive && 'bg-[var(--surface-4)]'
            )}
          >
            <Icon className={cn('mr-[6px] h-[14px] w-[14px] text-[var(--text-icon)]')} />
            {resource.title}
          </Button>
        )
      })}
    </div>
  )
}
