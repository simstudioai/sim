'use client'

import {
  type ElementType,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, PlayOutline, Skeleton, Tooltip, toast } from '@sim/emcn'
import {
  Download,
  FileX,
  Folder as FolderIcon,
  Library,
  Square,
  SquareArrowUpRight,
  Workflow as WorkflowIcon,
  WorkflowX,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { FileView, type PreviewMode, resolveFileCategory } from '@/components/resources/file-view'
import { KnowledgeView } from '@/components/resources/knowledge-view'
import { LogView } from '@/components/resources/log-view'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { TableView } from '@/components/resources/table-view'
import { useWorkspaceHostContext } from '@/components/workspace-host-provider'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkspaceUsageLimitAction } from '@/lib/billing/workspace-permissions'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  cancelRunToolExecution,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { triggerFileDownload } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { BrowserPanelOverlayController } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { BrowserSession } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session'
import { GenericResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/generic-resource-content'
import { TerminalSession } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session'
import {
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  GenericResourceData,
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail } from '@/hooks/queries/logs'
import { downloadTableExport } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import {
  grantsFromPermissions,
  type ResourceGrants,
  type ResourceKind,
  workspaceSource,
} from '@/resources'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const Workflow = lazy(() => import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow'))

const LOADING_SKELETON = (
  <div className='flex h-full flex-col gap-2 p-6'>
    <Skeleton className='h-[16px] w-[60%]' />
    <Skeleton className='h-[16px] w-[80%]' />
    <Skeleton className='h-[16px] w-[40%]' />
  </div>
)

/**
 * The mothership addresses a file either by its id or by the canonical workspace
 * path the agent used when it wrote the file, so both spellings resolve here.
 */
function findWorkspaceFile(
  files: WorkspaceFileRecord[],
  fileId: string,
  filePath: string | undefined
): WorkspaceFileRecord | undefined {
  return files.find(
    (f) =>
      f.id === fileId ||
      (filePath &&
        canonicalWorkspaceFilePath({ folderPath: f.folderPath, name: f.name }) === filePath)
  )
}

interface ResourceContentProps {
  workspaceId: string
  desktopScopeId: string
  resource: MothershipResource
  previewMode?: PreviewMode
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
  previewContextKey?: string
  /** Resolved server-side by the home page — the embedded table can't read
   *  AppConfig itself, so the flag is threaded down rather than looked up. */
  tableViewsEnabled?: boolean
  onNotFound?: (resourceId: string) => void
  /**
   * Whether this resource is the one on screen. Only the persistent panels
   * (browser, terminal) read it — to stand down document-wide observers while
   * hidden — so it defaults to visible for every other resource, which is only
   * ever rendered when active.
   */
  visible?: boolean
  /** Registers the active browser's targeted renderer-overlay handshake. */
  onBrowserOverlayControllerChange?: (controller: BrowserPanelOverlayController | null) => void
}

/**
 * The agent owns the file while it is streaming; nothing is edited from here.
 * Settled by construction — this is a literal, not a resolving membership.
 */
const STREAMING_FILE_GRANTS: ResourceGrants = {
  write: false,
  run: false,
  manage: false,
  settled: true,
}

/**
 * Grace window kept locked after the agent stops streaming into the file, so the lock bridges the
 * gaps between the file subagent's sequential edit sections instead of flickering open between them.
 */
const AGENT_EDIT_LOCK_GRACE_MS = 1500

/**
 * Holds the editor read-only while the agent is actively writing to the file, plus a short grace so
 * brief gaps between edit sections don't unlock it. Releases as soon as the turn ends
 * (`isAgentResponding` false) so the file becomes editable the moment the agent is done, even when
 * the surrounding turn keeps running — the completed preview session otherwise lingers all turn.
 */
function useAgentFileEditLock(isStreamingToFile: boolean, isAgentResponding: boolean): boolean {
  const [locked, setLocked] = useState(isStreamingToFile)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (graceTimerRef.current !== null) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
    if (isStreamingToFile) {
      setLocked(true)
      return
    }
    if (!isAgentResponding) {
      setLocked(false)
      return
    }
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null
      setLocked(false)
    }, AGENT_EDIT_LOCK_GRACE_MS)
    return () => {
      if (graceTimerRef.current !== null) {
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = null
      }
    }
  }, [isStreamingToFile, isAgentResponding])

  return locked
}

/**
 * The body of the active mothership tab.
 *
 * A kind with a canonical view is addressed, not re-implemented: the panel
 * builds a workspace {@link workspaceSource} and mounts that view at
 * `host='panel'`, so the file a tab shows is the same component the Files page
 * and a public share mount. The remaining kinds render their own surface here
 * until they have one.
 */
export const ResourceContent = memo(function ResourceContent({
  workspaceId,
  desktopScopeId,
  resource,
  previewMode,
  previewSession,
  isAgentResponding,
  genericResourceData,
  previewContextKey,
  tableViewsEnabled,
  onNotFound,
  visible = true,
  onBrowserOverlayControllerChange,
}: ResourceContentProps) {
  const router = useRouter()
  /** The host owns the router; the file view asks for a move, never holds one. */
  const navigate = useCallback((path: string) => router.push(path), [router])
  const streamFileName = previewSession?.fileName || 'file.md'

  const disableStreamingAutoScroll = previewSession?.operation === 'patch'
  // `append`/`patch` stream complete full-file snapshots (built on the existing file), so the editor
  // applies each live. `create`/`update` are streamed from scratch and would collapse an open doc, so
  // the editor holds until settle. See the rich-markdown streaming tick.
  const streamIsIncremental =
    previewSession?.operation === 'append' || previewSession?.operation === 'patch'
  const isTextPreview =
    !!previewSession && resolveFileCategory(null, previewSession.fileName) === 'text-editable'
  // Feed streamed content only while actively streaming. On completion the session keeps
  // `previewText` for history, but clearing it here lets the editor reconcile to the agent's
  // server-side write and hand off to the editable surface (the agent persists, not the editor).
  const textStreamingContent =
    isTextPreview &&
    previewSession?.status === 'streaming' &&
    typeof previewSession?.previewText === 'string' &&
    hasRenderableFilePreviewContent(previewSession)
      ? previewSession.previewText
      : undefined

  const isAgentEditing = useAgentFileEditLock(
    previewSession?.status === 'streaming',
    Boolean(isAgentResponding)
  )

  const isStreamingFile = resource.id === 'streaming-file'
  const isFileResource = resource.type === 'file' && !isStreamingFile

  const permissions = useUserPermissionsContext()
  const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])

  const {
    data: files = [],
    isLoading: isFilesLoading,
    isFetching: isFilesFetching,
  } = useWorkspaceFiles(workspaceId, 'active', { enabled: isFileResource })

  const file = useMemo(
    () => (isFileResource ? findWorkspaceFile(files, resource.id, resource.path) : undefined),
    [isFileResource, files, resource.id, resource.path]
  )

  const streamingFileSource = useMemo(
    () => workspaceSource({ kind: 'file', workspaceId, resourceId: 'streaming-file' }),
    [workspaceId]
  )

  const fileSource = useMemo(
    () => (file ? workspaceSource({ kind: 'file', workspaceId, resourceId: file.id }) : null),
    [file, workspaceId]
  )

  const isLogResource = resource.type === 'log'
  const {
    data: log,
    isLoading: isLogLoading,
    error: logError,
  } = useLogDetail(resource.id, workspaceId, { enabled: isLogResource })

  const knowledgeSource = useMemo(
    () => workspaceSource({ kind: 'knowledge' as const, workspaceId, resourceId: resource.id }),
    [workspaceId, resource.id]
  )

  const tableSource = useMemo(
    () => workspaceSource({ kind: 'table' as const, workspaceId, resourceId: resource.id }),
    [workspaceId, resource.id]
  )

  const logSource = useMemo(
    () => workspaceSource({ kind: 'log' as const, workspaceId, resourceId: resource.id }),
    [workspaceId, resource.id]
  )
  const { config: permissionConfig } = usePermissionConfig()

  const onNotFoundRef = useRef(onNotFound)
  onNotFoundRef.current = onNotFound

  useEffect(() => {
    if (!isLogResource) return
    if (isApiClientError(logError) && logError.status === 404) {
      onNotFoundRef.current?.(resource.id)
    }
  }, [isLogResource, logError, resource.id])

  if (isStreamingFile) {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        <FileView
          source={streamingFileSource}
          grants={STREAMING_FILE_GRANTS}
          host='panel'
          onNavigate={navigate}
          previewMode={previewMode ?? 'preview'}
          streaming={{
            fileName: streamFileName,
            content: textStreamingContent,
            isAgentEditing,
            isIncremental: streamIsIncremental,
            disableAutoScroll: disableStreamingAutoScroll,
            contextKey: previewContextKey,
          }}
        />
      </div>
    )
  }

  switch (resource.type) {
    case 'table':
      return (
        <TableView
          key={resource.id}
          host='panel'
          grants={grants}
          onNavigate={navigate}
          showExecutionInternals={!permissionConfig.hideTraceSpans}
          source={tableSource}
          features={{
            // Deliberately false: the home page resolves no `table-locks` flag,
            // so the panel has never offered lock settings. Giving it them means
            // resolving the flag server-side there — a product decision.
            locks: false,
            views: tableViewsEnabled ?? false,
          }}
        />
      )

    case 'file': {
      if (isFilesLoading || (isFilesFetching && !file)) return LOADING_SKELETON

      if (!file || !fileSource) {
        return (
          <ResourceEmptyState
            icon={FileX}
            title='File not found'
            description='This file may have been deleted or moved'
          />
        )
      }

      return (
        <div className='flex h-full flex-col overflow-hidden'>
          <FileView
            key={file.id}
            source={fileSource}
            grants={grants}
            host='panel'
            onNavigate={navigate}
            previewMode={previewMode}
            streaming={{
              content: previewSession?.fileId === resource.id ? textStreamingContent : undefined,
              isAgentEditing,
              isIncremental: streamIsIncremental,
              operation: previewSession?.operation,
              disableAutoScroll: disableStreamingAutoScroll,
              contextKey: previewContextKey,
            }}
            collaborative
          />
        </div>
      )
    }

    case 'workflow':
      return (
        <EmbeddedWorkflow key={resource.id} workspaceId={workspaceId} workflowId={resource.id} />
      )

    case 'knowledgebase':
      return (
        <KnowledgeView
          key={resource.id}
          knowledgeBaseName={resource.title}
          source={knowledgeSource}
          grants={grants}
          onNavigate={navigate}
          host='panel'
        />
      )

    case 'folder':
      return <EmbeddedFolder key={resource.id} workspaceId={workspaceId} folderId={resource.id} />

    case 'log': {
      if (isLogLoading) return LOADING_SKELETON

      if (!log) {
        return (
          <ResourceEmptyState
            icon={Library}
            title='Log not found'
            description='This log may have been deleted or is no longer available'
          />
        )
      }

      return (
        <div className='flex h-full flex-col overflow-hidden px-3.5 pt-3'>
          <LogView
            key={resource.id}
            source={logSource}
            grants={grants}
            host='panel'
            log={log}
            showExecutionInternals={!permissionConfig.hideTraceSpans}
            onNavigate={navigate}
          />
        </div>
      )
    }

    case 'generic':
      return (
        <GenericResourceContent key={resource.id} data={genericResourceData ?? { entries: [] }} />
      )

    case 'browser':
      return (
        <BrowserSession
          key={resource.id}
          scopeId={desktopScopeId}
          visible={visible}
          onOverlayControllerChange={onBrowserOverlayControllerChange}
        />
      )

    case 'terminal':
      return <TerminalSession key={resource.id} scopeId={desktopScopeId} visible={visible} />

    default:
      return null
  }
})

const actionsLogger = createLogger('ResourceTabActions')

/** One tab-header affordance: a tooltip-wrapped icon button. */
interface ResourceTabAction {
  key: string
  icon: ElementType
  /** The button's `aria-label`. */
  label: string
  /** Tooltip copy. Shorter than {@link label} where the label spells out the object. */
  tooltip: string
  onClick: () => void
  disabled?: boolean
}

/**
 * Everything a per-kind builder may need beyond the resource itself. Resolved
 * once by {@link ResourceTabActions} so the builders stay plain functions with
 * no hooks of their own.
 */
interface ResourceTabActionContext {
  workspaceId: string
  resource: MothershipResource
  /** Navigates the current tab. The host owns the router; builders only ask. */
  navigate: (href: string) => void
  /** The resolved workspace file record, when the tab shows a file. */
  file: WorkspaceFileRecord | undefined
  /** The log's execution id, when the tab shows a log and its detail has loaded. */
  logExecutionId: string | undefined
}

type ResourceTabActionBuilder = (context: ResourceTabActionContext) => ResourceTabAction[]

/** The "open this where it lives" button every actionable kind carries. */
function openAction(label: string, onClick: () => void): ResourceTabAction {
  return { key: 'open', icon: SquareArrowUpRight, label, tooltip: label, onClick }
}

/**
 * The same button, addressed through the resource axis rather than a hand-built
 * template string, so the route is declared exactly once in
 * `resourceHref`. `hrefFor` is typed `string | null` because a share source has
 * no in-app route; a workspace source always resolves one.
 */
function openResourceAction(
  label: string,
  kind: ResourceKind,
  { workspaceId, resource, navigate }: ResourceTabActionContext
): ResourceTabAction {
  const source = workspaceSource({ kind, workspaceId, resourceId: resource.id })
  return openAction(label, () => {
    const href = source.hrefFor({ to: 'self' })
    if (href) navigate(href)
  })
}

/**
 * The tab-header actions for each resource kind. A kind absent from this map
 * (folder, generic, browser, terminal, …) has no header actions.
 *
 * Two destinations deliberately do NOT come from the resource axis, because
 * routing them through it would change where the button goes:
 *
 * - `file` opens `/files/<id>`, the browser with the file selected. The axis
 *   spells `/files/<id>/view`, the separate fullscreen route. Both exist.
 * - `log` opens the logs page keyed on the *execution* id read off the fetched
 *   detail. The axis builds `?executionId=<resourceId>`, but a log resource is
 *   addressed by its log-row id, which is a different identifier.
 */
const RESOURCE_TAB_ACTIONS: Partial<Record<MothershipResourceType, ResourceTabActionBuilder>> = {
  /**
   * Not a resource kind — a workflow is a live collaborative session, not a
   * document with an address — so its route is spelled here. It is also the one
   * kind that opens a new browser tab instead of navigating in place.
   */
  workflow: ({ workspaceId, resource }) => [
    openAction('Open workflow', () =>
      window.open(`/workspace/${workspaceId}/w/${resource.id}`, '_blank')
    ),
  ],

  file: (context) => {
    const { workspaceId, resource, navigate, file } = context
    const download = async () => {
      if (!file) return
      try {
        await triggerFileDownload(file)
      } catch (err) {
        actionsLogger.error('Failed to download file:', err)
      }
    }
    return [
      openAction('Open in files', () =>
        navigate(`/workspace/${workspaceId}/files/${encodeURIComponent(file?.id ?? resource.id)}`)
      ),
      {
        key: 'download',
        icon: Download,
        label: 'Download file',
        tooltip: 'Download',
        disabled: !file,
        onClick: () => void download(),
      },
    ]
  },

  knowledgebase: (context) => [openResourceAction('Open knowledge base', 'knowledge', context)],

  table: (context) => {
    const { resource } = context
    const exportCsv = async () => {
      try {
        await downloadTableExport(resource.id, resource.title)
      } catch (err) {
        actionsLogger.error('Failed to export table:', err)
      }
    }
    return [
      openResourceAction('Open table', 'table', context),
      {
        key: 'export',
        icon: Download,
        label: 'Export table as CSV',
        tooltip: 'Export CSV',
        onClick: () => void exportCsv(),
      },
    ]
  },

  log: ({ workspaceId, navigate, logExecutionId }) => [
    openAction('Open in logs', () =>
      navigate(
        `/workspace/${workspaceId}/logs${logExecutionId ? `?executionId=${logExecutionId}` : ''}`
      )
    ),
  ],
}

function ResourceTabActionButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled,
}: Omit<ResourceTabAction, 'key'>) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={onClick}
          disabled={disabled}
          className={RESOURCE_TAB_ICON_BUTTON_CLASS}
          aria-label={label}
        >
          <Icon className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{tooltip}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

interface ResourceTabActionsProps {
  workspaceId: string
  resource: MothershipResource
}

/**
 * The action buttons in the active tab's header, keyed by resource type through
 * {@link RESOURCE_TAB_ACTIONS}.
 *
 * The two lookups a builder cannot do for itself are resolved here and gated on
 * the kind that needs them, so a table tab mounts neither the file list nor a
 * log detail. Workflow's run control stays a component of its own: it carries
 * the execution machinery, the usage gate, and a `setActiveWorkflow` effect that
 * must not run for any other kind.
 */
export function ResourceTabActions({ workspaceId, resource }: ResourceTabActionsProps) {
  const router = useRouter()
  const navigate = useCallback((href: string) => router.push(href), [router])

  const isFile = resource.type === 'file'
  const isLog = resource.type === 'log'

  const { data: files = [] } = useWorkspaceFiles(workspaceId, 'active', { enabled: isFile })
  const file = useMemo(
    () => (isFile ? findWorkspaceFile(files, resource.id, resource.path) : undefined),
    [isFile, files, resource.id, resource.path]
  )
  const { data: log } = useLogDetail(isLog ? resource.id : undefined, workspaceId)

  const actions =
    RESOURCE_TAB_ACTIONS[resource.type]?.({
      workspaceId,
      resource,
      navigate,
      file,
      logExecutionId: log?.executionId ?? undefined,
    }) ?? []

  return (
    <>
      {actions.map(({ key, ...action }) => (
        <ResourceTabActionButton key={key} {...action} />
      ))}
      {resource.type === 'workflow' && (
        <WorkflowRunControl workspaceId={workspaceId} workflowId={resource.id} />
      )}
    </>
  )
}

interface WorkflowRunControlProps {
  workspaceId: string
  workflowId: string
}

/** Runs or stops the workflow shown in the active tab. */
function WorkflowRunControl({ workspaceId, workflowId }: WorkflowRunControlProps) {
  const { navigateToSettings } = useSettingsNavigation()
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { userPermissions: effectivePermissions } = useWorkspacePermissionsContext()
  const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)
  const { handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
  const isExecuting = useExecutionStore(
    (state) => state.workflowExecutions.get(workflowId)?.isExecuting ?? false
  )
  const {
    usageExceeded,
    message: usageLimitMessage,
    scope: usageLimitScope,
    isLoading: isUsageGateLoading,
  } = useUsageLimits({ workspaceId })

  useEffect(() => {
    void setActiveWorkflow(workflowId)
  }, [workflowId, setActiveWorkflow])

  const isRunButtonDisabled =
    !isExecuting &&
    (isUsageGateLoading || (!effectivePermissions.canRead && !effectivePermissions.isLoading))

  const handleRun = async () => {
    setActiveWorkflow(workflowId)

    if (isExecuting) {
      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)
      await handleCancelExecution()
      await reportManualRunToolStop(workflowId, toolCallId)
      return
    }

    if (isUsageGateLoading) return

    if (usageExceeded) {
      const action = getWorkspaceUsageLimitAction(hostContext, session?.user?.id, {
        message: usageLimitMessage,
        scope: usageLimitScope,
      })
      if (action.type === 'manage-billing') {
        navigateToSettings({ section: 'billing' })
      } else {
        toast.error(action.message)
      }
      return
    }

    await handleRunWorkflow()
  }

  return (
    <ResourceTabActionButton
      icon={isExecuting ? Square : PlayOutline}
      label={isExecuting ? 'Stop workflow' : 'Run workflow'}
      tooltip={isExecuting ? 'Stop' : 'Run workflow'}
      disabled={isRunButtonDisabled}
      onClick={() => void handleRun()}
    />
  )
}

interface EmbeddedWorkflowProps {
  workspaceId: string
  workflowId: string
}

function EmbeddedWorkflow({ workspaceId, workflowId }: EmbeddedWorkflowProps) {
  const { data: workflowList, isPending: isWorkflowsPending } = useWorkflows(workspaceId)
  const workflowExists = (workflowList ?? []).some((w) => w.id === workflowId)
  const hasLoadError = useWorkflowRegistry(
    (state) => state.hydration.phase === 'error' && state.hydration.workflowId === workflowId
  )

  if (isWorkflowsPending) return LOADING_SKELETON

  if (!workflowExists || hasLoadError) {
    return (
      <ResourceEmptyState
        icon={WorkflowX}
        title='Workflow not found'
        description='This workflow may have been deleted or moved'
      />
    )
  }

  return (
    <Suspense fallback={LOADING_SKELETON}>
      <Workflow workspaceId={workspaceId} workflowId={workflowId} embedded />
    </Suspense>
  )
}

interface EmbeddedFolderProps {
  workspaceId: string
  folderId: string
}

function EmbeddedFolder({ workspaceId, folderId }: EmbeddedFolderProps) {
  const { data: folderList, isPending: isFoldersPending } = useFolders(workspaceId)
  const { data: workflowList = [] } = useWorkflows(workspaceId)

  const folder = (folderList ?? []).find((f) => f.id === folderId)
  const folderWorkflows = workflowList.filter((w) => w.folderId === folderId)

  if (isFoldersPending) return LOADING_SKELETON

  if (!folder) {
    return (
      <ResourceEmptyState
        icon={FolderIcon}
        title='Folder not found'
        description='This folder may have been deleted or moved'
      />
    )
  }

  return (
    <div className='flex h-full flex-col overflow-y-auto p-6'>
      <h2 className='mb-4 text-[16px] text-[var(--text-primary)]'>{folder.name}</h2>
      {folderWorkflows.length === 0 ? (
        <p className='text-[13px] text-[var(--text-muted)]'>No workflows in this folder</p>
      ) : (
        <div className='flex flex-col gap-1'>
          {folderWorkflows.map((w) => (
            <button
              key={w.id}
              type='button'
              onClick={() => window.open(`/workspace/${workspaceId}/w/${w.id}`, '_blank')}
              className='flex items-center gap-2 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-4)]'
            >
              <WorkflowIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='truncate text-[13px] text-[var(--text-primary)]'>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
