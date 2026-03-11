'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { ResourceContent, ResourceTabs } from './components'

const PREVIEWABLE_EXTENSIONS = new Set(['md', 'html', 'htm', 'csv'])
const PREVIEW_ONLY_EXTENSIONS = new Set(['html', 'htm'])

const PREVIEW_CYCLE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
} as const

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

  const [previewMode, setPreviewMode] = useState<PreviewMode>('split')
  const handleCyclePreview = useCallback(() => setPreviewMode((m) => PREVIEW_CYCLE[m]), [])

  useEffect(() => {
    const ext = active?.type === 'file' ? getFileExtension(active.title) : ''
    setPreviewMode(PREVIEW_ONLY_EXTENSIONS.has(ext) ? 'preview' : 'split')
  }, [active?.id])

  const isActivePreviewable =
    active?.type === 'file' && PREVIEWABLE_EXTENSIONS.has(getFileExtension(active.title))

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden border-[var(--border)] transition-[width,min-width,border-width] duration-300 ease-out',
        isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-[50%] min-w-[400px] border-l',
        className
      )}
    >
      <div className='flex min-h-0 min-w-[400px] flex-1 flex-col'>
        <ResourceTabs
          resources={resources}
          activeId={active?.id ?? null}
          onSelect={onSelectResource}
          onCollapse={onCollapse}
          previewMode={isActivePreviewable ? previewMode : undefined}
          onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
        />
        <div className='min-h-0 flex-1 overflow-hidden'>
          {active && (
            <ResourceContent
              workspaceId={workspaceId}
              resource={active}
              previewMode={isActivePreviewable ? previewMode : undefined}
            />
          )}
        </div>
      </div>
    </div>
  )
}
