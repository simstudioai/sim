'use client'

import {
  type ComponentProps,
  forwardRef,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chip, cn } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { MothershipTableViewContext } from '@/lib/api/contracts/mothership-resources'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { ResourceNavigationProvider } from '@/app/workspace/[workspaceId]/components/resource/resource-navigation'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  isCsvStreamOnly,
  isMarkdownFile,
  isPreviewable,
  RICH_PREVIEWABLE_EXTENSIONS,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { ChatPanelContent } from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import { ChatPanelSwell } from '@/app/workspace/[workspaceId]/home/components/chat-panel-swell'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import type { BrowserPanelOverlayController } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { BrowserSession } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session'
import { GenericResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/generic-resource-content'
import { SearchResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/search-resource-content'
import { SourcesResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content'
import { TerminalSession } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { ResourcePanelNavigation } from '@/app/workspace/[workspaceId]/home/components/resource-panel-navigation'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { ResourceActions, ResourceContent, ResourceTabs } from './components'

/**
 * Panels that are kept mounted across resource switches rather than rebuilt.
 *
 * Both wrap live state the renderer does not own: a browser page is a native
 * view the main process positions from a measured rect, and each terminal is
 * an xterm fed from a pty whose scrollback has to be replayed to rebuild it.
 * Everything else re-renders from data that is already in memory and is cheap
 * to mount on demand.
 */
function isPersistentPanel(resource: MothershipResource): boolean {
  return resource.type === 'browser' || resource.type === 'terminal'
}

/**
 * The live panels to keep mounted, one per kind: every browser tab shares one
 * panel and every terminal tab shares one, each showing whichever of its tabs
 * is selected, so the first resource of a kind stands in for all of them.
 */
function persistentPanelResources(resources: MothershipResource[]): MothershipResource[] {
  const panels: MothershipResource[] = []
  const seen = new Set<MothershipResourceType>()
  for (const resource of resources) {
    if (!isPersistentPanel(resource) || seen.has(resource.type)) continue
    seen.add(resource.type)
    panels.push(resource)
  }
  return panels
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
  navigation?: ResourcePanelNavigation
  workspaceId?: string
  organizationId?: string
  allowBuildControls?: boolean
  chatId?: string
  desktopScopeId: string
  onTableViewContextChange?: (tableId: string, context: MothershipTableViewContext) => void
  resources: MothershipResource[]
  activeResourceId: string | null
  activityResourceIds?: ReadonlySet<string>
  isCollapsed: boolean
  className?: string
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  onSummarize: (message: string, filters: WorkspaceSearchFilters) => void
  /** Claims the current resource selection after direct panel interaction. */
  onUserInteraction?: () => void
  /** With a navigation control, the panel opens and closes through the control's swell. */
  onTogglePanel?: () => void
  /** Moves the panel to its open or closed state without animating. */
  skipTransition?: boolean
}

export const MothershipView = memo(
  forwardRef<HTMLDivElement, MothershipViewProps>(function MothershipView(
    {
      navigation,
      workspaceId,
      organizationId,
      allowBuildControls,
      chatId,
      desktopScopeId,
      resources,
      onTableViewContextChange,
      activeResourceId,
      activityResourceIds,
      isCollapsed,
      className,
      previewSession,
      isAgentResponding,
      onSummarize,
      onUserInteraction,
      onTogglePanel,
      skipTransition = false,
    }: MothershipViewProps,
    ref
  ) {
    const active = navigation?.active
      ? null
      : (resources.find((r) => getChatResourceSelectionId(r) === activeResourceId) ?? null)
    const activeWorkspaceId = active?.workspaceId ?? workspaceId
    const inheritedPermissions = useUserPermissionsContext()
    const permissions = useWorkspacePermissionsQuery(organizationId ? activeWorkspaceId : undefined)
    const scopedPermissions = useUserPermissions(
      permissions.data ?? null,
      permissions.isPending,
      permissions.error?.message ?? null
    )
    const canEdit = organizationId
      ? Boolean(activeWorkspaceId) && !permissions.error && scopedPermissions.canEdit
      : inheritedPermissions.canEdit
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

    const persistentResources = persistentPanelResources(resources)

    const previewForActive =
      previewSession && active && shouldShowStreamingFilePanel(previewSession, active)
        ? previewSession
        : undefined

    const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')
    const handleCyclePreview = () => setPreviewMode((m) => PREVIEW_CYCLE[m])

    const activeSelectionId = active ? getChatResourceSelectionId(active) : undefined
    const [prevActiveId, setPrevActiveId] = useState(activeSelectionId)
    if (prevActiveId !== activeSelectionId) {
      setPrevActiveId(activeSelectionId)
      setPreviewMode('preview')
    }

    // A large CSV renders read-only (streamed) with no editor, so it must not offer the
    // edit/split/preview toggle. Its size lives on the file record, not the resource tab.
    const { data: files, isLoading: filesLoading } = useWorkspaceFiles(
      activeWorkspaceId ?? '',
      'active',
      {
        enabled: Boolean(activeWorkspaceId) && active?.type === 'file',
      }
    )
    const activeFile = active?.type === 'file' ? files?.find((f) => f.id === active.id) : undefined
    const isActiveCsv = active?.type === 'file' && getFileExtension(active.title) === 'csv'

    const isActiveFilePreviewable =
      canEdit &&
      active?.type === 'file' &&
      // Dashboards store extensionless names, so the record's type decides once it loads.
      (activeFile
        ? isPreviewable(activeFile)
        : RICH_PREVIEWABLE_EXTENSIONS.has(getFileExtension(active.title))) &&
      // Markdown renders in the single-surface inline editor (streamed preview → editable in place),
      // so it has no raw/split/preview toggle to offer.
      !isMarkdownFile(activeFile ?? { type: '', name: active.title }) &&
      // Only a CSV's previewability depends on its size (large = read-only, no editor). Wait for
      // the record before deciding so the toggle doesn't flash on for a large CSV — but don't gate
      // other rich types (html, svg, …) on the file list loading.
      !(isActiveCsv && filesLoading) &&
      !(activeFile && isCsvStreamOnly(activeFile)) &&
      // A Sim page is locked to its rendered view (the pdf model — the raw
      // source is not a mode this surface offers), so no toggle either.
      activeFile?.type !== SIM_PAGE_CONTENT_TYPE
    // A test shows its source, its results, or both, like an HTML file; the viewer enforces edits.
    const isActivePreviewable = isActiveFilePreviewable || active?.type === 'test'
    const swell = navigation?.control && onTogglePanel ? onTogglePanel : undefined

    return (
      <>
        {swell && navigation && (
          <ChatPanelSwell
            label='Project'
            toggleLabel={`Expand resource view${
              activityResourceIds?.size
                ? `, ${activityResourceIds.size} resource${activityResourceIds.size === 1 ? '' : 's'} updated`
                : ''
            }`}
            activityCount={activityResourceIds?.size ?? 0}
            idle={!isCollapsed && !navigation.controlActive}
            collapsed={isCollapsed}
            instant={skipTransition}
            onExpand={swell}
          />
        )}
        <ChatPanelContent
          ref={ref}
          collapsed={isCollapsed}
          swell={Boolean(swell)}
          onInteraction={onUserInteraction}
          className={className}
        >
          <div className='flex min-h-0 flex-1 flex-col'>
            <ResourceTabs
              navigation={navigation}
              organizationId={organizationId}
              allowBuildControls={allowBuildControls}
              workspaceId={workspaceId}
              desktopScopeId={desktopScopeId}
              chatId={chatId}
              resources={resources}
              activeId={active ? getChatResourceSelectionId(active) : null}
              activityIds={activityResourceIds}
              actions={
                !navigation && active && active.type !== 'search' && activeWorkspaceId ? (
                  <ResourceWorkspaceHost
                    workspaceId={activeWorkspaceId}
                    organizationId={organizationId}
                    workflowId={active.type === 'workflow' ? active.id : undefined}
                    isFileViewer={active.type === 'file'}
                  >
                    <ResourceActions
                      allowWorkspaceNavigation={!navigation}
                      workspaceId={activeWorkspaceId}
                      resource={active}
                      downloadSourceRef={fileDownloadSourceRef}
                    />
                  </ResourceWorkspaceHost>
                ) : null
              }
              previewMode={!navigation && isActivePreviewable ? previewMode : undefined}
              onCyclePreviewMode={
                !navigation && isActivePreviewable ? handleCyclePreview : undefined
              }
              onRequestAddResourceOpen={requestAddResourceOpen}
              onAddResourceClose={closeAddResource}
              onCollapse={swell}
            />
            <div
              data-swell-card={swell ? '' : undefined}
              className={cn(
                'relative min-h-0 flex-1 overflow-hidden',
                swell &&
                  'md:absolute md:top-10 md:right-[calc(0.5rem*var(--swell-progress))] md:bottom-2 md:left-[calc(0.5rem*var(--swell-progress))] md:rounded-xl md:border md:border-[color-mix(in_srgb,var(--border)_calc(var(--swell-edge,1)*100%),transparent)] md:bg-[var(--surface-2)] md:[&>*]:min-w-[calc(var(--chat-panel-width)-18px)] md:[&>*]:opacity-[var(--swell-content-opacity,1)]'
              )}
            >
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
              {persistentResources.map((resource) => {
                const panelVisible = active?.type === resource.type
                return (
                  <div
                    key={`${desktopScopeId}:${resource.type}`}
                    className={cn('absolute inset-0', !panelVisible && 'hidden')}
                  >
                    {/*
                  A hidden persistent panel can otherwise only INFER it is off
                  screen by measuring itself, which is enough to pause xterm and
                  hide the native view but not to switch off document-wide
                  observers the panel installs. The explicit flag lets it stand
                  those down while hidden.
                */}
                    <ScopedResourceContent
                      workspaceId={resource.workspaceId ?? workspaceId}
                      organizationId={organizationId}
                      desktopScopeId={desktopScopeId}
                      resource={resource}
                      onSummarize={onSummarize}
                      visible={panelVisible}
                      onBrowserOverlayControllerChange={registerBrowserOverlayController}
                    />
                  </div>
                )
              })}
              {active?.type === 'sources' && (
                <SourcesResourceContent resource={active} chatId={chatId} />
              )}
              {active && active.type !== 'sources' && !isPersistentPanel(active) && (
                <ActiveResourceFrame navigation={navigation} resource={active}>
                  <ScopedResourceContent
                    showHeader={Boolean(navigation)}
                    onBrowse={navigation ? () => navigation.onBrowseResource(active) : undefined}
                    onCyclePreviewMode={isActivePreviewable ? handleCyclePreview : undefined}
                    workspaceId={activeWorkspaceId}
                    organizationId={organizationId}
                    desktopScopeId={desktopScopeId}
                    resource={active}
                    onSummarize={onSummarize}
                    downloadSourceRef={fileDownloadSourceRef}
                    onTableViewContextChange={onTableViewContextChange}
                    previewMode={isActivePreviewable ? previewMode : undefined}
                    previewSession={previewForActive}
                    isAgentResponding={isAgentResponding}
                    previewContextKey={chatId}
                    onNotFound={(resourceId) =>
                      removeResource('log', resourceId, active.workspaceId)
                    }
                  />
                </ActiveResourceFrame>
              )}
              {navigation?.active && navigation.content}
              {!active && !navigation?.active && (
                <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
                  {workspaceId
                    ? 'Click "+" above to add a resource'
                    : 'Open a resource from the conversation'}
                </div>
              )}
            </div>
          </div>
        </ChatPanelContent>
      </>
    )
  })
)

interface PaneResourceNavigationProps {
  navigation: ResourcePanelNavigation
  resource: MothershipResource
  children: ReactNode
}

/**
 * Keeps a resource's own navigation inside the pane. A replace means this tab's view is gone
 * (its workflow was deleted or never existed), so the tab closes; a workflow the editor pushes
 * (a duplicate) opens as a tab; lists and other destinations go to the pane's navigation.
 */
function PaneResourceNavigation({ navigation, resource, children }: PaneResourceNavigationProps) {
  const { addResource, removeResource } = useMothershipResources()
  const queryClient = useQueryClient()
  const navigate = useCallback(
    (href: string, replace = false) => {
      const url = new URL(href, window.location.origin)
      const [, scope, workspaceId, section, workflowId] = url.pathname.split('/')
      const workflowArea =
        url.origin === window.location.origin &&
        scope === 'workspace' &&
        Boolean(workspaceId) &&
        (!section || section === 'w')
      if (!workflowArea) {
        navigation.navigate(href)
        return
      }
      if (replace) {
        removeResource(resource.type, resource.id, resource.workspaceId)
        return
      }
      if (!workflowId) {
        navigation.navigate(href)
        return
      }
      const workflow = queryClient
        .getQueryData<WorkflowMetadata[]>(workflowKeys.list(workspaceId))
        ?.find((candidate) => candidate.id === workflowId)
      addResource({
        type: 'workflow',
        id: workflowId,
        workspaceId,
        title: workflow?.name ?? 'Workflow',
      })
    },
    [navigation, resource, addResource, removeResource, queryClient]
  )
  return (
    <ResourceNavigationProvider
      navigate={navigate}
      openResource={addResource}
      onDirectory={() => navigation.onBrowseResource(resource)}
    >
      {children}
    </ResourceNavigationProvider>
  )
}

interface ActiveResourceFrameProps {
  navigation?: ResourcePanelNavigation
  resource: MothershipResource
  children: ReactNode
}

function ActiveResourceFrame({ navigation, resource, children }: ActiveResourceFrameProps) {
  if (!navigation) return children
  return (
    <PaneResourceNavigation navigation={navigation} resource={resource}>
      {children}
    </PaneResourceNavigation>
  )
}

/** The full editor under the pane's tab strip, rendering its own header bar into the slot. */
function PaneHostedWorkflow(props: ComponentProps<typeof ResourceContent>) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  const host = useMemo(() => ({ header }), [header])
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div ref={setHeader} className='shrink-0' />
      <div className='min-h-0 flex-1 overflow-hidden'>
        <ResourceContent {...props} workflowHost={host} />
      </div>
    </div>
  )
}

function ScopedResourceContent({
  workspaceId,
  organizationId,
  onSummarize,
  showHeader,
  onBrowse,
  onCyclePreviewMode,
  ...props
}: Omit<ComponentProps<typeof ResourceContent>, 'workspaceId'> & {
  workspaceId?: string
  organizationId?: string
  showHeader?: boolean
  onBrowse?: () => void
  onCyclePreviewMode?: () => void
  onSummarize: (message: string, filters: WorkspaceSearchFilters) => void
}) {
  if (props.resource.type === 'search')
    return <SearchResourceContent resource={props.resource} onSummarize={onSummarize} />
  if (!workspaceId) {
    if (props.resource.type === 'generic') return <GenericResourceContent />
    if (props.resource.type === 'browser')
      return (
        <BrowserSession
          scopeId={props.desktopScopeId}
          visible={props.visible ?? true}
          onOverlayControllerChange={props.onBrowserOverlayControllerChange}
        />
      )
    if (props.resource.type === 'terminal')
      return <TerminalSession scopeId={props.desktopScopeId} visible={props.visible ?? true} />
    return (
      <div role='status' className='p-4 text-[var(--text-muted)] text-sm'>
        This resource has no workspace address.
      </div>
    )
  }
  if (!organizationId) return <ResourceContent workspaceId={workspaceId} {...props} />
  if (showHeader && props.resource.type === 'workflow') {
    return (
      <ResourceWorkspaceHost
        workspaceId={workspaceId}
        organizationId={organizationId}
        workflowId={props.resource.id}
        isFileViewer={false}
      >
        <PaneHostedWorkflow workspaceId={workspaceId} {...props} />
      </ResourceWorkspaceHost>
    )
  }
  return (
    <ResourceWorkspaceHost
      workspaceId={workspaceId}
      organizationId={organizationId}
      workflowId={props.resource.type === 'workflow' ? props.resource.id : undefined}
      isFileViewer={props.resource.type === 'file'}
    >
      {showHeader ? (
        <div className='flex h-full min-h-0 flex-col'>
          <Resource.Header
            icon={getResourceConfig(props.resource.type).icon}
            breadcrumbs={[
              { label: getResourceConfig(props.resource.type).label, onClick: onBrowse },
              { label: props.resource.title },
            ]}
            aside={
              <>
                {props.resource.type !== 'workflow' && (
                  <ResourceActions
                    workspaceId={workspaceId}
                    resource={props.resource}
                    downloadSourceRef={props.downloadSourceRef}
                    allowWorkspaceNavigation={false}
                  />
                )}
                {onCyclePreviewMode && (
                  <Chip onClick={onCyclePreviewMode}>View: {props.previewMode}</Chip>
                )}
              </>
            }
          />
          <div className='min-h-0 flex-1 overflow-hidden'>
            <ResourceContent workspaceId={workspaceId} {...props} />
          </div>
        </div>
      ) : (
        <ResourceContent workspaceId={workspaceId} {...props} />
      )}
    </ResourceWorkspaceHost>
  )
}
