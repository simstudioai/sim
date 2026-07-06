'use client'

import { forwardRef, memo, useState } from 'react'
import { cn } from '@sim/emcn'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  isCsvStreamOnly,
  isMarkdownFile,
  RICH_PREVIEWABLE_EXTENSIONS,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { ResourceActions, ResourceContent, ResourceTabs } from './components'

const PREVIEW_CYCLE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
} as const

/**
 * Whether the active resource should show the in-progress file stream.
 * The synthetic `streaming-file` tab always shows it; a real file tab only shows it
 * after a preview content event has arrived for that exact resource.
 */
function shouldShowStreamingFilePanel(
  previewSession: FilePreviewSession | null | undefined,
  active: MothershipResource | null
): boolean {
  if (!previewSession || !hasRenderableFilePreviewContent(previewSession) || !active) return false
  if (active.id === 'streaming-file') return true
  if (active.type !== 'file') return false
  if (active.id && previewSession.fileId === active.id) {
    return true
  }
  return false
}

interface MothershipViewProps {
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeResourceId: string | null
  isCollapsed: boolean
  className?: string
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
}

export const MothershipView = memo(
  forwardRef<HTMLDivElement, MothershipViewProps>(function MothershipView(
    {
      workspaceId,
      chatId,
      resources,
      activeResourceId,
      isCollapsed,
      className,
      previewSession,
      isAgentResponding,
      genericResourceData,
    }: MothershipViewProps,
    ref
  ) {
    const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null
    const { canEdit } = useUserPermissionsContext()
    const { removeResource } = useMothershipResources()

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

    // A large CSV renders read-only (streamed) with no editor, so it must not offer the
    // edit/split/preview toggle. Its size lives on the file record, not the resource tab.
    const { data: files, isLoading: filesLoading } = useWorkspaceFiles(workspaceId, 'active', {
      enabled: active?.type === 'file',
    })
    const activeFile = active?.type === 'file' ? files?.find((f) => f.id === active.id) : undefined
    const isActiveCsv = active?.type === 'file' && getFileExtension(active.title) === 'csv'

    const isActivePreviewable =
      canEdit &&
      active?.type === 'file' &&
      RICH_PREVIEWABLE_EXTENSIONS.has(getFileExtension(active.title)) &&
      // Markdown renders in the single-surface inline editor (streamed preview → editable in place),
      // so it has no raw/split/preview toggle to offer.
      !isMarkdownFile({ type: '', name: active.title }) &&
      // Only a CSV's previewability depends on its size (large = read-only, no editor). Wait for
      // the record before deciding so the toggle doesn't flash on for a large CSV — but don't gate
      // other rich types (html, svg, …) on the file list loading.
      !(isActiveCsv && filesLoading) &&
      !(activeFile && isCsvStreamOnly(activeFile))

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
            actions={
              active ? (
                <ResourceActions workspaceId={workspaceId} resource={active} chatId={chatId} />
              ) : null
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
                isAgentResponding={isAgentResponding}
                genericResourceData={active.type === 'generic' ? genericResourceData : undefined}
                previewContextKey={chatId}
                onNotFound={(resourceId) => removeResource('log', resourceId)}
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
