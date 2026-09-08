'use client'

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, OverflowText, PlayOutline, Skeleton, Tooltip, toast } from '@sim/emcn'
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
import { prefersInPlaceNavigation } from '@/lib/desktop'
import { type FileDownloadSource, triggerFileDownload } from '@/lib/uploads/client/download'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  FileViewer,
  type PreviewMode,
  resolveFileCategory,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
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
} from '@/app/workspace/[workspaceId]/home/types'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import { LogDetailsContent } from '@/app/workspace/[workspaceId]/logs/components'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/table'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail } from '@/hooks/queries/logs'
import { exportTable } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useExecutionStore } from '@/stores/execution/store'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'
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
 * Opens an internal app link the way the host expects: a new browser tab on the
 * web, and the current view in the desktop app, whose shell would otherwise turn
 * the same-origin `window.open` into a second Sim window.
 */
function useOpenInternalLink() {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      if (prefersInPlaceNavigation()) {
        router.push(href)
        return
      }
      window.open(href, '_blank')
    },
    [router]
  )
}

interface ResourceContentProps {
  workspaceId: string
  desktopScopeId: string
  resource: MothershipResource
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  previewMode?: PreviewMode
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
  previewContextKey?: string
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
 * Renders the content for the currently active mothership resource.
 * Handles table, file, and workflow resource types with appropriate
 * embedded rendering for each.
 */
const STREAMING_EPOCH = new Date(0)

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

export const ResourceContent = memo(function ResourceContent({
  workspaceId,
  desktopScopeId,
  resource,
  downloadSourceRef,
  previewMode,
  previewSession,
  isAgentResponding,
  genericResourceData,
  previewContextKey,
  onNotFound,
  visible = true,
  onBrowserOverlayControllerChange,
}: ResourceContentProps) {
  const observedTableViewRef = useRef<{ tableId: string; viewId?: string } | null>(null)

  useEffect(() => {
    const previous = observedTableViewRef.current
    const next =
      resource.type === 'table' ? { tableId: resource.id, viewId: resource.viewId } : null
    observedTableViewRef.current = next
    if (!next?.viewId || (previous?.tableId === next.tableId && previous.viewId === next.viewId)) {
      return
    }
    /**
     * Pinned on mount as well as on later changes. `initialViewId` alone is not
     * enough: the table honours it only while its views query already carries
     * that id, and a cached list from before the agent wrote the view resolves
     * it to nothing. Adoption then settles on the default and never revisits
     * the id, so the restored view is lost until the tab is reopened. The pin
     * waits for the refetch instead, and costs nothing when adoption already
     * applied the same view — the table consumes it without touching the URL.
     */
    useTableViewPinStore.getState().pin(next.tableId, next.viewId)
  }, [resource.id, resource.type, resource.viewId])

  const streamFileName = previewSession?.fileName || 'file.md'
  const syntheticFile = useMemo(() => {
    const ext = getFileExtension(streamFileName)
    const SOURCE_MIME_MAP: Record<string, string> = {
      pptx: 'text/x-pptxgenjs',
      docx: 'text/x-docxjs',
      pdf: 'text/x-pdflibjs',
    }
    const type = SOURCE_MIME_MAP[ext] ?? getMimeTypeFromExtension(ext)
    return {
      id: 'streaming-file',
      workspaceId,
      name: streamFileName,
      key: '',
      path: '',
      size: 0,
      type,
      uploadedBy: '',
      uploadedAt: STREAMING_EPOCH,
      updatedAt: STREAMING_EPOCH,
    }
  }, [workspaceId, streamFileName])

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

  if (resource.id === 'streaming-file') {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        <FileViewer
          file={syntheticFile}
          workspaceId={workspaceId}
          canEdit={false}
          previewMode={previewMode ?? 'preview'}
          streamingContent={textStreamingContent}
          isAgentEditing={isAgentEditing}
          streamIsIncremental={streamIsIncremental}
          disableStreamingAutoScroll={disableStreamingAutoScroll}
          previewContextKey={previewContextKey}
        />
      </div>
    )
  }

  switch (resource.type) {
    case 'table':
      return (
        <Table
          key={resource.id}
          workspaceId={workspaceId}
          tableId={resource.id}
          embedded
          initialViewId={resource.viewId}
        />
      )

    case 'file':
      return (
        <EmbeddedFile
          key={resource.id}
          workspaceId={workspaceId}
          fileId={resource.id}
          filePath={resource.path}
          downloadSourceRef={downloadSourceRef}
          previewMode={previewMode}
          streamingContent={
            previewSession?.fileId === resource.id ? textStreamingContent : undefined
          }
          isAgentEditing={isAgentEditing}
          streamIsIncremental={streamIsIncremental}
          streamOperation={previewSession?.operation}
          disableStreamingAutoScroll={disableStreamingAutoScroll}
          previewContextKey={previewContextKey}
        />
      )

    case 'workflow':
      return (
        <EmbeddedWorkflow key={resource.id} workspaceId={workspaceId} workflowId={resource.id} />
      )

    case 'knowledgebase':
      return (
        <KnowledgeBase
          key={resource.id}
          id={resource.id}
          knowledgeBaseName={resource.title}
          workspaceId={workspaceId}
        />
      )

    case 'folder':
      return <EmbeddedFolder key={resource.id} workspaceId={workspaceId} folderId={resource.id} />

    case 'log':
      return (
        <EmbeddedLog
          key={resource.id}
          workspaceId={workspaceId}
          logId={resource.id}
          onNotFound={onNotFound ? () => onNotFound(resource.id) : undefined}
        />
      )

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

interface ResourceActionsProps {
  workspaceId: string
  resource: MothershipResource
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
}

export function ResourceActions({
  workspaceId,
  resource,
  downloadSourceRef,
}: ResourceActionsProps) {
  switch (resource.type) {
    case 'workflow':
      return <EmbeddedWorkflowActions workspaceId={workspaceId} workflowId={resource.id} />
    case 'file':
      return (
        <EmbeddedFileActions
          workspaceId={workspaceId}
          fileId={resource.id}
          filePath={resource.path}
          downloadSourceRef={downloadSourceRef}
        />
      )
    case 'knowledgebase':
      return (
        <EmbeddedKnowledgeBaseActions workspaceId={workspaceId} knowledgeBaseId={resource.id} />
      )
    case 'table':
      return <EmbeddedTableActions workspaceId={workspaceId} tableId={resource.id} />
    case 'log':
      return <EmbeddedLogActions workspaceId={workspaceId} logId={resource.id} />
    case 'folder':
    case 'generic':
    case 'browser':
    case 'terminal':
      return null
    default:
      return null
  }
}

interface EmbeddedWorkflowActionsProps {
  workspaceId: string
  workflowId: string
}

export function EmbeddedWorkflowActions({ workspaceId, workflowId }: EmbeddedWorkflowActionsProps) {
  const openInternalLink = useOpenInternalLink()
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

  const handleOpenWorkflow = () => {
    openInternalLink(`/workspace/${workspaceId}/w/${workflowId}`)
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={handleOpenWorkflow}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Open workflow'
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Open workflow</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleRun()}
            disabled={isRunButtonDisabled}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label={isExecuting ? 'Stop workflow' : 'Run workflow'}
          >
            {isExecuting ? (
              <Square className={RESOURCE_TAB_ICON_CLASS} />
            ) : (
              <PlayOutline className={RESOURCE_TAB_ICON_CLASS} />
            )}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{isExecuting ? 'Stop' : 'Run workflow'}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </>
  )
}

interface EmbeddedKnowledgeBaseActionsProps {
  workspaceId: string
  knowledgeBaseId: string
}

export function EmbeddedKnowledgeBaseActions({
  workspaceId,
  knowledgeBaseId,
}: EmbeddedKnowledgeBaseActionsProps) {
  const router = useRouter()

  const handleOpenKnowledgeBase = () => {
    router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`)
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={handleOpenKnowledgeBase}
          className={RESOURCE_TAB_ICON_BUTTON_CLASS}
          aria-label='Open knowledge base'
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Open knowledge base</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const tableLogger = createLogger('EmbeddedTableActions')

interface EmbeddedTableActionsProps {
  workspaceId: string
  tableId: string
}

function EmbeddedTableActions({ workspaceId, tableId }: EmbeddedTableActionsProps) {
  const router = useRouter()

  const handleOpenTable = () => {
    router.push(`/workspace/${workspaceId}/tables/${tableId}`)
  }

  const handleExport = async () => {
    try {
      await exportTable(workspaceId, tableId)
    } catch (err) {
      tableLogger.error('Failed to export table:', err)
    }
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={handleOpenTable}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Open table'
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Open table</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleExport()}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Export table as CSV'
          >
            <Download className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Export CSV</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </>
  )
}

const fileLogger = createLogger('EmbeddedFileActions')

interface EmbeddedFileActionsProps {
  workspaceId: string
  fileId: string
  filePath?: string
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
}

function EmbeddedFileActions({
  workspaceId,
  fileId,
  filePath,
  downloadSourceRef,
}: EmbeddedFileActionsProps) {
  const router = useRouter()
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const file = useMemo(
    () =>
      files.find(
        (f) =>
          f.id === fileId ||
          (filePath &&
            canonicalWorkspaceFilePath({ folderPath: f.folderPath, name: f.name }) === filePath)
      ),
    [files, fileId, filePath]
  )

  const handleDownload = async () => {
    if (!file) return
    try {
      await triggerFileDownload(file, downloadSourceRef?.current)
    } catch (err) {
      fileLogger.error('Failed to download file:', err)
    }
  }

  const handleOpenInFiles = () => {
    router.push(`/workspace/${workspaceId}/files/${encodeURIComponent(file?.id ?? fileId)}`)
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={handleOpenInFiles}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Open in files'
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Open in files</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleDownload()}
            disabled={!file}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Download file'
          >
            <Download className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Download</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </>
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
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <WorkflowX className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='text-[20px] text-[var(--text-primary)]'>Workflow not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This workflow may have been deleted or moved
          </p>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={LOADING_SKELETON}>
      <Workflow workspaceId={workspaceId} workflowId={workflowId} embedded />
    </Suspense>
  )
}

interface EmbeddedFileProps {
  workspaceId: string
  fileId: string
  filePath?: string
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  previewMode?: PreviewMode
  streamingContent?: string
  isAgentEditing?: boolean
  streamIsIncremental?: boolean
  streamOperation?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

function EmbeddedFile({
  workspaceId,
  fileId,
  filePath,
  downloadSourceRef,
  previewMode,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  streamOperation,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: EmbeddedFileProps) {
  const { canEdit } = useUserPermissionsContext()
  const { data: files = [], isLoading, isFetching } = useWorkspaceFiles(workspaceId)
  const file = useMemo(
    () =>
      files.find(
        (f) =>
          f.id === fileId ||
          (filePath &&
            canonicalWorkspaceFilePath({ folderPath: f.folderPath, name: f.name }) === filePath)
      ),
    [files, fileId, filePath]
  )

  if (isLoading || (isFetching && !file)) return LOADING_SKELETON

  if (!file) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FileX className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='text-[20px] text-[var(--text-primary)]'>File not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This file may have been deleted or moved
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <FileViewer
        key={file.id}
        file={file}
        downloadSourceRef={downloadSourceRef}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode}
        streamingContent={streamingContent}
        isAgentEditing={isAgentEditing}
        streamIsIncremental={streamIsIncremental}
        streamOperation={streamOperation}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
        collaborative
        enableFind
      />
    </div>
  )
}

interface EmbeddedFolderProps {
  workspaceId: string
  folderId: string
}

function EmbeddedFolder({ workspaceId, folderId }: EmbeddedFolderProps) {
  const openInternalLink = useOpenInternalLink()
  const { data: folderList, isPending: isFoldersPending } = useFolders(workspaceId)
  const { data: workflowList = [] } = useWorkflows(workspaceId)

  const folder = (folderList ?? []).find((f) => f.id === folderId)
  const folderWorkflows = workflowList.filter((w) => w.folderId === folderId)

  if (isFoldersPending) return LOADING_SKELETON

  if (!folder) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FolderIcon className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='text-[20px] text-[var(--text-primary)]'>Folder not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This folder may have been deleted or moved
          </p>
        </div>
      </div>
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
              onClick={() => openInternalLink(`/workspace/${workspaceId}/w/${w.id}`)}
              className='flex items-center gap-2 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-4)]'
            >
              <WorkflowIcon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              <OverflowText label={w.name} className='text-[var(--text-primary)] text-small' />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface EmbeddedLogProps {
  workspaceId: string
  logId: string
  onNotFound?: () => void
}

function EmbeddedLog({ workspaceId, logId, onNotFound }: EmbeddedLogProps) {
  const { data: log, isLoading, error } = useLogDetail(logId, workspaceId)

  const onNotFoundRef = useRef(onNotFound)
  onNotFoundRef.current = onNotFound

  useEffect(() => {
    if (isApiClientError(error) && error.status === 404) {
      onNotFoundRef.current?.()
    }
  }, [error])

  if (isLoading) return LOADING_SKELETON

  if (!log) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <Library className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='text-[20px] text-[var(--text-primary)]'>Log not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This log may have been deleted or is no longer available
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden px-3.5 pt-3'>
      <LogDetailsContent log={log} />
    </div>
  )
}

interface EmbeddedLogActionsProps {
  workspaceId: string
  logId: string
}

export function EmbeddedLogActions({ workspaceId, logId }: EmbeddedLogActionsProps) {
  const router = useRouter()
  const { data: log } = useLogDetail(logId, workspaceId)

  const handleOpenInLogs = () => {
    const param = log?.executionId ? `?executionId=${log.executionId}` : ''
    router.push(`/workspace/${workspaceId}/logs${param}`)
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={handleOpenInLogs}
          className={RESOURCE_TAB_ICON_BUTTON_CLASS}
          aria-label='Open in logs'
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Open in logs</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
