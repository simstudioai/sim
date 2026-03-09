'use client'

import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { ResourceContent, ResourceTabs } from './components'

interface MothershipViewProps {
  workspaceId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  onSelectResource: (id: string) => void
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
}: MothershipViewProps) {
  const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null

  return (
    <div className='flex h-full w-[50%] min-w-[400px] flex-col border-[var(--border)] border-l'>
      <ResourceTabs
        resources={resources}
        activeId={active?.id ?? null}
        onSelect={onSelectResource}
      />
      <div className='min-h-0 flex-1 overflow-hidden'>
        {active && <ResourceContent workspaceId={workspaceId} resource={active} />}
      </div>
    </div>
  )
}
