'use client'

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, PlayOutline, Skeleton, Tooltip, toast } from '@sim/emcn'
import {
  Calendar,
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
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { FileView, type PreviewMode, resolveFileCategory } from '@/components/resources/file-view'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
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
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { GenericResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/generic-resource-content'
import {
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { hasRenderableFilePreviewContent } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { Interface } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/interface'
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
import { useScheduleById } from '@/hooks/queries/schedules'
import { downloadTableExport } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { grantsFromPermissions, type ResourceGrants, workspaceSource } from '@/resources'
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
  resource: MothershipResource
  previewMode?: PreviewMode
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
  previewContextKey?: string
  onNotFound?: (resourceId: string) => void
}

/** The agent owns the file while it is streaming; nothing is edited from here. */
const STREAMING_FILE_GRANTS: ResourceGrants = { write: false, run: 'none' }

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
  resource,
  previewMode,
  previewSession,
  isAgentResponding,
  genericResourceData,
  previewContextKey,
  onNotFound,
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
      return <Table key={resource.id} workspaceId={workspaceId} tableId={resource.id} embedded />

    case 'interface':
      return (
        <Interface
          key={resource.id}
          workspaceId={workspaceId}
          interfaceId={resource.id}
          host='panel'
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
              disableAutoScroll: disableStreamingAutoScroll,
              contextKey: previewContextKey,
            }}
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
        <KnowledgeBase
          key={resource.id}
          id={resource.id}
          knowledgeBaseName={resource.title}
          workspaceId={workspaceId}
        />
      )

    case 'folder':
      return <EmbeddedFolder key={resource.id} workspaceId={workspaceId} folderId={resource.id} />

    case 'scheduledtask':
      return <EmbeddedScheduledTask key={resource.id} scheduleId={resource.id} />

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

    default:
      return null
  }
})

interface ResourceActionsProps {
  workspaceId: string
  resource: MothershipResource
}

export function ResourceActions({ workspaceId, resource }: ResourceActionsProps) {
  switch (resource.type) {
    case 'workflow':
      return <EmbeddedWorkflowActions workspaceId={workspaceId} workflowId={resource.id} />
    case 'file':
      return (
        <EmbeddedFileActions
          workspaceId={workspaceId}
          fileId={resource.id}
          filePath={resource.path}
        />
      )
    case 'knowledgebase':
      return (
        <EmbeddedKnowledgeBaseActions workspaceId={workspaceId} knowledgeBaseId={resource.id} />
      )
    case 'table':
      return (
        <EmbeddedTableActions
          workspaceId={workspaceId}
          tableId={resource.id}
          tableName={resource.title}
        />
      )
    case 'interface':
      return <EmbeddedInterfaceActions workspaceId={workspaceId} interfaceId={resource.id} />
    case 'log':
      return <EmbeddedLogActions workspaceId={workspaceId} logId={resource.id} />
    case 'scheduledtask':
      return <EmbeddedScheduledTaskActions workspaceId={workspaceId} />
    case 'folder':
    case 'generic':
      return null
    default:
      return null
  }
}

interface EmbeddedWorkflowActionsProps {
  workspaceId: string
  workflowId: string
}

function EmbeddedWorkflowActions({ workspaceId, workflowId }: EmbeddedWorkflowActionsProps) {
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
    window.open(`/workspace/${workspaceId}/w/${workflowId}`, '_blank')
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

function EmbeddedKnowledgeBaseActions({
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

interface EmbeddedInterfaceActionsProps {
  workspaceId: string
  interfaceId: string
}

function EmbeddedInterfaceActions({ workspaceId, interfaceId }: EmbeddedInterfaceActionsProps) {
  const router = useRouter()

  const handleOpenInterface = () => {
    router.push(`/workspace/${workspaceId}/interfaces/${interfaceId}`)
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={handleOpenInterface}
          className={RESOURCE_TAB_ICON_BUTTON_CLASS}
          aria-label='Open interface'
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Open interface</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const tableLogger = createLogger('EmbeddedTableActions')

interface EmbeddedTableActionsProps {
  workspaceId: string
  tableId: string
  tableName: string
}

function EmbeddedTableActions({ workspaceId, tableId, tableName }: EmbeddedTableActionsProps) {
  const router = useRouter()

  const handleOpenTable = () => {
    router.push(`/workspace/${workspaceId}/tables/${tableId}`)
  }

  const handleExport = async () => {
    try {
      await downloadTableExport(tableId, tableName)
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
}

function EmbeddedFileActions({ workspaceId, fileId, filePath }: EmbeddedFileActionsProps) {
  const router = useRouter()
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const file = useMemo(() => findWorkspaceFile(files, fileId, filePath), [files, fileId, filePath])

  const handleDownload = async () => {
    if (!file) return
    try {
      await triggerFileDownload(file)
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
      <h2 className='mb-4 font-medium text-[16px] text-[var(--text-primary)]'>{folder.name}</h2>
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

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  disabled: 'Paused',
  completed: 'Completed',
}

function formatScheduleInstant(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : format(date, "EEE, MMM d 'at' h:mm a")
}

interface ScheduledTaskFieldProps {
  title: string
  value: string
}

function ScheduledTaskField({ title, value }: ScheduledTaskFieldProps) {
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-[var(--text-muted)] text-caption'>{title}</span>
      <span className='text-[var(--text-body)] text-small'>{value}</span>
    </div>
  )
}

interface EmbeddedScheduledTaskProps {
  scheduleId: string
}

function EmbeddedScheduledTask({ scheduleId }: EmbeddedScheduledTaskProps) {
  const { data: schedule, isLoading, isError } = useScheduleById(scheduleId)

  if (isLoading && !schedule) return LOADING_SKELETON

  if (!schedule) {
    return (
      <ResourceEmptyState
        icon={Calendar}
        title={isError ? "Couldn't load scheduled task" : 'Scheduled task not found'}
        description={
          isError
            ? 'Something went wrong loading this scheduled task. Try again.'
            : 'This scheduled task may have been deleted'
        }
      />
    )
  }

  const title = schedule.jobTitle || schedule.prompt || 'Scheduled task'
  const timing = schedule.cronExpression
    ? parseCronToHumanReadable(schedule.cronExpression, schedule.timezone)
    : 'Runs once'
  const status = SCHEDULE_STATUS_LABEL[schedule.status] ?? schedule.status

  return (
    <div className='flex h-full flex-col gap-6 overflow-y-auto p-6'>
      <div className='flex items-center gap-2'>
        <Calendar className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <h2 className='truncate font-medium text-[16px] text-[var(--text-primary)]'>{title}</h2>
      </div>

      <div className='grid grid-cols-2 gap-4'>
        <ScheduledTaskField title='Status' value={status} />
        <ScheduledTaskField title='Schedule' value={timing} />
        <ScheduledTaskField title='Next run' value={formatScheduleInstant(schedule.nextRunAt)} />
        <ScheduledTaskField title='Last run' value={formatScheduleInstant(schedule.lastRanAt)} />
      </div>

      <div className='flex flex-col gap-1'>
        <span className='text-[var(--text-muted)] text-caption'>Prompt</span>
        <p className='whitespace-pre-wrap text-[var(--text-body)] text-small'>
          {schedule.prompt || '—'}
        </p>
      </div>

      {schedule.jobHistory && schedule.jobHistory.length > 0 && (
        <div className='flex flex-col gap-2'>
          <span className='text-[var(--text-muted)] text-caption'>Recent runs</span>
          <div className='flex flex-col gap-2'>
            {schedule.jobHistory.slice(0, 5).map((run, index) => (
              <div
                key={`${run.timestamp}-${index}`}
                className='flex flex-col gap-1 rounded-[6px] bg-[var(--surface-4)] px-3 py-2'
              >
                <span className='text-[var(--text-tertiary)] text-caption'>
                  {formatScheduleInstant(run.timestamp)}
                </span>
                <span className='text-[var(--text-body)] text-small'>{run.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface EmbeddedScheduledTaskActionsProps {
  workspaceId: string
}

function EmbeddedScheduledTaskActions({ workspaceId }: EmbeddedScheduledTaskActionsProps) {
  const router = useRouter()

  const handleOpenScheduledTasks = () => {
    router.push(`/workspace/${workspaceId}/scheduled-tasks`)
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={handleOpenScheduledTasks}
          className={RESOURCE_TAB_ICON_BUTTON_CLASS}
          aria-label='Open in scheduled tasks'
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Open in scheduled tasks</p>
      </Tooltip.Content>
    </Tooltip.Root>
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
      <ResourceEmptyState
        icon={Library}
        title='Log not found'
        description='This log may have been deleted or is no longer available'
      />
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

function EmbeddedLogActions({ workspaceId, logId }: EmbeddedLogActionsProps) {
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
