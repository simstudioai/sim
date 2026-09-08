'use client'

import { forwardRef, memo, useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  isCsvStreamOnly,
  isMarkdownFile,
  RICH_PREVIEWABLE_EXTENSIONS,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import type { BrowserPanelOverlayController } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { ResourceActions, ResourceContent, ResourceTabs } from './components'

/**
 * Panels that are kept mounted across resource switches rather than rebuilt.
 *
 * These two are singletons wrapping live state the renderer does not own: the
 * browser's page is a native view the main process positions from a measured
 * rect, and each terminal is an xterm fed from a pty whose scrollback has to
 * be replayed to rebuild it. Everything else re-renders from data that is
 * already in memory and is cheap to mount on demand.
 */
function isPersistentPanel(resource: MothershipResource): boolean {
  return resource.type === 'browser' || resource.type === 'terminal'
}

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
  desktopScopeId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  activityResourceIds?: ReadonlySet<string>
  isCollapsed: boolean
  className?: string
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
  /** Claims the current resource selection after direct panel interaction. */
  onUserInteraction?: () => void
}

export const MothershipView = memo(
  forwardRef<HTMLDivElement, MothershipViewProps>(function MothershipView(
    {
      workspaceId,
      chatId,
      desktopScopeId,
      resources,
      activeResourceId,
      activityResourceIds,
      isCollapsed,
      className,
      previewSession,
      isAgentResponding,
      genericResourceData,
      onUserInteraction,
    }: MothershipViewProps,
    ref
  ) {
    const active = resources.find((r) => r.id === activeResourceId) ?? null
    const { canEdit } = useUserPermissionsContext()
    const { removeResource } = useMothershipResources()
    const browserOverlayControllerRef = useRef<BrowserPanelOverlayController | null>(null)
    const fileDownloadSourceRef = useRef<FileDownloadSource | null>(null)

    const registerBrowserOverlayController = useCallback(
      (controller: BrowserPanelOverlayController | null) => {
        browserOverlayControllerRef.current = controller
      },
      []
    )

    const requestAddResourceOpen = useCallback(
      (open: () => void) => {
        const controller = browserOverlayControllerRef.current
        if (active?.type !== 'browser' || !controller) {
          open()
          return
        }
        let didOpen = false
        const openOnce = () => {
          if (didOpen) return
          didOpen = true
          open()
        }
        void controller.requestOverlay('resources', openOnce).then(openOnce, openOnce)
      },
      [active?.type]
    )

    const closeAddResource = useCallback(() => {
      return browserOverlayControllerRef.current?.closeOverlay('resources') ?? Promise.resolve()
    }, [])

    const persistentResources = useMemo(() => resources.filter(isPersistentPanel), [resources])

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
      !(activeFile && isCsvStreamOnly(activeFile)) &&
      // A Sim page is locked to its rendered view (the pdf model — the raw
      // source is not a mode this surface offers), so no toggle either.
      activeFile?.type !== SIM_PAGE_CONTENT_TYPE

    return (
      <div
        ref={ref}
        // Read by the browser panel to declare its resize anchor: an inline px
        // width means a divider drag pinned it, otherwise `w-1/2` governs.
        data-mothership-panel=''
        onPointerDownCapture={onUserInteraction}
        onKeyDownCapture={onUserInteraction}
        className={cn(
          'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
          isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-1/2 border-l',
          /* This panel is the right half of the pane, never under the traffic lights,
             yet it embeds whole pages whose header bars reserve that lane. Zeroing the
             inherited variable here keeps their top bars flush inside the panel. */
          '[--workspace-content-title-bar-inset:0px]',
          className
        )}
      >
        <div className='flex min-h-0 flex-1 flex-col'>
          <ResourceTabs
            workspaceId={workspaceId}
            desktopScopeId={desktopScopeId}
            chatId={chatId}
            resources={resources}
            activeId={active?.id ?? null}
            activityIds={activityResourceIds}
            actions={
              active ? (
                <ResourceActions
                  workspaceId={workspaceId}
                  resource={active}
                  downloadSourceRef={fileDownloadSourceRef}
                />
              ) : null
            }
            previewMode={isActivePreviewable ? previewMode : undefined}
            onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
            onRequestAddResourceOpen={requestAddResourceOpen}
            onAddResourceClose={closeAddResource}
          />
          <div className='relative min-h-0 flex-1 overflow-hidden'>
            {/*
              The browser and terminal panels stay mounted while another
              resource is showing. Both are backed by state the renderer
              cannot cheaply rebuild — a live native view positioned from a
              measured rect, and xterm instances whose scrollback is replayed
              from the main process — so tearing them down on every tab switch
              is what made switching back blank out and stall. `hidden`
              collapses them to 0x0, which each panel already reads as "not on
              screen": the browser reports no bounds and its native view hides
              itself, and the terminals stop being measured.
            */}
            {persistentResources.map((resource) => (
              <div
                key={`${desktopScopeId}:${resource.id}`}
                className={cn('absolute inset-0', resource.id !== active?.id && 'hidden')}
              >
                {/*
                  A hidden persistent panel can otherwise only INFER it is off
                  screen by measuring itself, which is enough to pause xterm and
                  hide the native view but not to switch off document-wide
                  observers the panel installs. The explicit flag lets it stand
                  those down while hidden.
                */}
                <ResourceContent
                  workspaceId={workspaceId}
                  desktopScopeId={desktopScopeId}
                  resource={resource}
                  visible={resource.id === active?.id}
                  onBrowserOverlayControllerChange={registerBrowserOverlayController}
                />
              </div>
            ))}
            {active && !isPersistentPanel(active) && (
              <ResourceContent
                workspaceId={workspaceId}
                desktopScopeId={desktopScopeId}
                resource={active}
                downloadSourceRef={fileDownloadSourceRef}
                previewMode={isActivePreviewable ? previewMode : undefined}
                previewSession={previewForActive}
                isAgentResponding={isAgentResponding}
                genericResourceData={active.type === 'generic' ? genericResourceData : undefined}
                previewContextKey={chatId}
                onNotFound={(resourceId) => removeResource('log', resourceId)}
              />
            )}
            {!active && (
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
