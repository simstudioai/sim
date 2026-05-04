'use client'

import { forwardRef, memo, useState } from 'react'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RICH_PREVIEWABLE_EXTENSIONS } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  GenericResourceData,
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ResourceActions, ResourceContent, ResourceTabs } from './components'

const PREVIEW_CYCLE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
} as const

/**
 * Whether the active resource should show the in-progress file stream.
 * The synthetic `streaming-file` tab always shows it; a real file tab only shows it
 * when the streamed fileId matches that exact resource.
 */
function shouldShowStreamingFilePanel(
  previewSession: FilePreviewSession | null | undefined,
  active: MothershipResource | null
): boolean {
  if (!previewSession || previewSession.status === 'complete' || !active) return false
  if (active.id === 'streaming-file') return true
  if (active.type !== 'file') return false
  if (active.id && previewSession.fileId === active.id) return true
  return false
}

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
  previewSession?: FilePreviewSession | null
  genericResourceData?: GenericResourceData
}

export const MothershipView = memo(
  forwardRef<HTMLDivElement, MothershipViewProps>(function MothershipView(
    {
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
      previewSession,
      genericResourceData,
    }: MothershipViewProps,
    ref
  ) {
    const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null
    const { canEdit } = useUserPermissionsContext()

    const previewForActive =
      previewSession && active && shouldShowStreamingFilePanel(previewSession, active)
        ? previewSession
        : undefined

    const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')
    const handleCyclePreview = () => setPreviewMode((m) => PREVIEW_CYCLE[m])

    const [prevActiveId, setPrevActiveId] = useState(active?.id)
    if (prevActiveId !== active?.id) {
      setPrevActiveId(active?.id)
      setPreviewMode('preview')
    }

    const isActivePreviewable =
      canEdit &&
      active?.type === 'file' &&
      RICH_PREVIEWABLE_EXTENSIONS.has(getFileExtension(active.title))

    return (
      <div
        ref={ref}
        className={cn(
          'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
          isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-1/2 border-l',
          className
        )}
      >
        <div className='flex min-h-0 flex-1 flex-col'>
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
            actions={
              active ? <ResourceActions workspaceId={workspaceId} resource={active} /> : null
            }
            previewMode={isActivePreviewable ? previewMode : undefined}
            onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
          />
          <div className='min-h-0 flex-1 overflow-hidden'>
            {active ? (
              <ResourceContent
                workspaceId={workspaceId}
                resource={active}
                previewMode={isActivePreviewable ? previewMode : undefined}
                previewSession={previewForActive}
                genericResourceData={active.type === 'generic' ? genericResourceData : undefined}
                previewContextKey={chatId}
                onNotFound={(resourceId) => onRemoveResource('log', resourceId)}
              />
            ) : (
              <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
                Click "+" above to add a resource
              </div>
            )}
          </div>
        </div>
      </div>
    )
  })
)
