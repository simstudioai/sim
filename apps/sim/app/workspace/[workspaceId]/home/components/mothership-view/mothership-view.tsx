'use client'

import { forwardRef, memo, useCallback, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RICH_PREVIEWABLE_EXTENSIONS } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
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

function streamFileBasename(name: string): string {
  const n = name.replace(/\\/g, '/').trim()
  const parts = n.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : n
}

function fileTitlesEquivalent(streamFileName: string, resourceTitle: string): boolean {
  return streamFileBasename(streamFileName) === streamFileBasename(resourceTitle)
}

/**
 * Whether the active resource should show the in-progress file_write stream.
 * The synthetic `streaming-file` tab always shows it; a real file tab shows it when
 * the streamed `fileName` matches that resource (so users who stay on the open file see live text).
 */
function streamReferencesFileId(raw: string, fileId: string): boolean {
  if (!fileId) return false
  const escaped = fileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`"fileId"\\s*:\\s*"${escaped}"`).test(raw)
}

function shouldShowStreamingFilePanel(
  streamingFile: { fileName: string; content: string } | null | undefined,
  active: MothershipResource | null
): boolean {
  if (!streamingFile || !active) return false
  if (active.id === 'streaming-file') return true
  if (active.type !== 'file') return false
  const fn = streamingFile.fileName.trim()
  if (fn && fileTitlesEquivalent(fn, active.title)) return true
  if (active.id && streamReferencesFileId(streamingFile.content, active.id)) return true
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
  streamingFile?: { fileName: string; content: string } | null
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
      streamingFile,
    }: MothershipViewProps,
    ref
  ) {
    const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null
    const { canEdit } = useUserPermissionsContext()

    const streamingForActive =
      streamingFile && active && shouldShowStreamingFilePanel(streamingFile, active)
        ? streamingFile
        : undefined

    const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')
    const [prevActiveId, setPrevActiveId] = useState<string | null | undefined>(active?.id)
    const handleCyclePreview = useCallback(() => setPreviewMode((m) => PREVIEW_CYCLE[m]), [])

    // Reset preview mode to default when the active resource changes (guarded render-phase update)
    if (active?.id !== prevActiveId) {
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
          'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-300 ease-out',
          isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-[60%] border-l',
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
                streamingFile={streamingForActive}
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
)
