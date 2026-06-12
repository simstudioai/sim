'use client'

import { forwardRef, memo, type ReactNode, useState } from 'react'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import type { MothershipResourceType } from '@/lib/copilot/resources/types'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { PanelChromeProvider } from '@/app/workspace/[workspaceId]/components/panel-chrome-context'
import { SidebarToggleHidden } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RICH_PREVIEWABLE_EXTENSIONS } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  PanelEmptyState,
  PanelHeader,
  PanelTrailingControls,
  ResourceActions,
  ResourceContent,
  ResourcePanelToggle,
} from './components'

const PREVIEW_CYCLE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
} as const

/**
 * Staged views that render their own `Resource.Header` (workspace area pages,
 * knowledge base detail). The panel skips its header for these and injects its
 * controls into theirs via {@link PanelChromeProvider}, so there is exactly
 * one header row either way.
 */
const OWN_HEADER_RESOURCE_TYPES: ReadonlySet<MothershipResourceType> = new Set([
  'page',
  'knowledgebase',
])

/**
 * Whether the active resource should show the in-progress file stream.
 * The synthetic `streaming-file` resource always shows it; a real file only
 * shows it after a preview content event has arrived for that exact resource.
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
  /** The staged resource — the single thing the panel shows. */
  resource: MothershipResource | null
  isCollapsed: boolean
  className?: string
  previewSession?: FilePreviewSession | null
  genericResourceData?: GenericResourceData
  /** Controls rendered before the panel title (see {@link PanelHeader}). */
  headerLeading?: ReactNode
}

/**
 * The right-side resource panel. It has no tabs: it shows exactly one resource
 * at a time — whatever the Mothership conversation last touched (a table, a
 * file, a knowledge base, a workspace page, or a workflow's full editor).
 */
export const MothershipView = memo(
  forwardRef<HTMLDivElement, MothershipViewProps>(function MothershipView(
    {
      workspaceId,
      chatId,
      resource,
      isCollapsed,
      className,
      previewSession,
      genericResourceData,
      headerLeading,
    }: MothershipViewProps,
    ref
  ) {
    const active = resource
    const { canEdit } = useUserPermissionsContext()
    const { openResource, closeResource } = useMothershipResources()

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

    const hasOwnHeader = Boolean(active && OWN_HEADER_RESOURCE_TYPES.has(active.type))

    const content = active && (
      <SidebarToggleHidden>
        <ResourceContent
          workspaceId={workspaceId}
          resource={active}
          previewMode={isActivePreviewable ? previewMode : undefined}
          previewSession={previewForActive}
          genericResourceData={active.type === 'generic' ? genericResourceData : undefined}
          previewContextKey={chatId}
          onNotFound={closeResource}
          onAddResource={openResource}
        />
      </SidebarToggleHidden>
    )

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
          {active && !hasOwnHeader && (
            <PanelHeader
              workspaceId={workspaceId}
              resource={active}
              leading={headerLeading}
              actions={<ResourceActions workspaceId={workspaceId} resource={active} />}
              previewMode={isActivePreviewable ? previewMode : undefined}
              onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
            />
          )}
          {/* Empty state with the chat pane hidden: the panel is the whole
              view, so a slim chrome bar keeps the sidebar toggle and chat
              switcher (the way back to the conversation) reachable. */}
          {!active && !isCollapsed && headerLeading && (
            <div className='flex h-[44px] shrink-0 items-center gap-1.5 border-[var(--border)] border-b px-4'>
              {headerLeading}
              <div className='ml-auto flex shrink-0 items-center'>
                <ResourcePanelToggle placeholder className='-mr-[9px]' />
              </div>
            </div>
          )}
          <div className='min-h-0 flex-1 overflow-hidden'>
            {hasOwnHeader ? (
              <PanelChromeProvider
                leading={headerLeading}
                controls={<PanelTrailingControls closeLabel={`Close ${active?.title ?? 'view'}`} />}
              >
                {content}
              </PanelChromeProvider>
            ) : (
              content
            )}
            {/* Opened with nothing staged: a quick-open surface instead of a
                blank pane. Gated on the expanded state so the hidden panel
                never mounts it. */}
            {!active && !isCollapsed && <PanelEmptyState workspaceId={workspaceId} />}
          </div>
        </div>
      </div>
    )
  })
)
