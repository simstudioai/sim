'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RICH_PREVIEWABLE_EXTENSIONS } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { ResourceActions, ResourceContent, ResourceTabs } from './components'

const PREVIEW_CYCLE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
} as const

interface MothershipViewProps {
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeResourceId: string | null
  onSelectResource: (id: string) => void
  onAddResource: (resource: MothershipResource) => void
  onRemoveResource: (resourceType: MothershipResourceType, resourceId: string) => void
  onReorderResources: (resources: MothershipResource[]) => void
  onCollapse: () => void
  isCollapsed: boolean
  className?: string
}

export const MothershipView = memo(function MothershipView({
  workspaceId,
  chatId,
  resources,
  activeResourceId,
  onSelectResource,
  onAddResource,
  onRemoveResource,
  onReorderResources,
  onCollapse,
  isCollapsed,
  className,
}: MothershipViewProps) {
  const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null

  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')
  const handleCyclePreview = useCallback(() => setPreviewMode((m) => PREVIEW_CYCLE[m]), [])

  useEffect(() => {
    setPreviewMode('preview')
  }, [active?.id])

  const isActivePreviewable =
    active?.type === 'file' && RICH_PREVIEWABLE_EXTENSIONS.has(getFileExtension(active.title))

  return (
    <div
      className={cn(
        'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-300 ease-out',
        isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-[50%] min-w-[400px] border-l',
        className
      )}
    >
      <div className='flex min-h-0 min-w-[400px] flex-1 flex-col'>
        <ResourceTabs
          workspaceId={workspaceId}
          chatId={chatId}
          resources={resources}
          activeId={active?.id ?? null}
          onSelect={onSelectResource}
          onAddResource={onAddResource}
          onRemoveResource={onRemoveResource}
          onReorderResources={onReorderResources}
          onCollapse={onCollapse}
          actions={active ? <ResourceActions workspaceId={workspaceId} resource={active} /> : null}
          previewMode={isActivePreviewable ? previewMode : undefined}
          onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
        />
        <div className='min-h-0 flex-1 overflow-hidden'>
          {active ? (
            <ResourceContent
              workspaceId={workspaceId}
              resource={active}
              previewMode={isActivePreviewable ? previewMode : undefined}
            />
          ) : (
            <div className='flex h-full items-center justify-center text-[14px] text-[var(--text-muted)]'>
              Click "+" above to add a resource
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
