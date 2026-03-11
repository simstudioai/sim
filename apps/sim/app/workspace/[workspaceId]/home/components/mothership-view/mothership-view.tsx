'use client'

import { cn } from '@/lib/core/utils/cn'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { ResourceContent, ResourceTabs } from './components'

interface MothershipViewProps {
  workspaceId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  onSelectResource: (id: string) => void
  onCollapse: () => void
  isCollapsed: boolean
  className?: string
}

/**
 * Split-pane view that renders embedded resources (tables, files, workflows)
 * alongside the chat conversation. Composes ResourceTabs for navigation
 * and ResourceContent for rendering the active resource.
 */
export function MothershipView({
  workspaceId,
  resources,
  activeResourceId,
  onSelectResource,
  onCollapse,
  isCollapsed,
  className,
}: MothershipViewProps) {
  const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden border-[var(--border)] transition-[width,min-width,border-width] duration-300 ease-out',
        isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-[50%] min-w-[400px] border-l',
        className
      )}
    >
      <div className='flex min-w-[400px] flex-1 flex-col'>
        <ResourceTabs
          resources={resources}
          activeId={active?.id ?? null}
          onSelect={onSelectResource}
          onCollapse={onCollapse}
        />
        <div className='min-h-0 flex-1 overflow-hidden'>
          {active && <ResourceContent workspaceId={workspaceId} resource={active} />}
        </div>
      </div>
    </div>
  )
}
