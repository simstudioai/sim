'use client'

import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { Button, PlayOutline, Skeleton, Tooltip } from '@/components/emcn'
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
} from '@/components/emcn/icons'
import { isApiClientError } from '@/lib/api/client/errors'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  cancelRunToolExecution,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { triggerFileDownload } from '@/lib/uploads/client/download'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import {
  FileViewer,
  type PreviewMode,
  resolveFileCategory,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
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
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import { LogDetailsContent } from '@/app/workspace/[workspaceId]/logs/components'
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
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useTranslations } from 'next-intl'

const Workflow = lazy(() => import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow'))

const LOADING_SKELETON = (
  <div className='flex h-full flex-col gap-2 p-6'>
    <Skeleton className='h-[16px] w-[60%]' />
    <Skeleton className='h-[16px] w-[80%]' />
    <Skeleton className='h-[16px] w-[40%]' />
  </div>
)

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
  resource,
  previewMode,
  previewSession,
  isAgentResponding,
  genericResourceData,
  previewContextKey,
  onNotFound,
}: ResourceContentProps) {
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
      return <Table key={resource.id} workspaceId={workspaceId} tableId={resource.id} embedded />

    case 'file':
      return (
        <EmbeddedFile
          key={resource.id}
          workspaceId={workspaceId}
          fileId={resource.id}
          filePath={resource.path}
          previewMode={previewMode}
          streamingContent={
            previewSession?.fileId === resource.id ? textStreamingContent : undefined
          }
          isAgentEditing={isAgentEditing}
          streamIsIncremental={streamIsIncremental}
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

    case 'scheduledtask':
      return (
        <EmbeddedScheduledTask
          key={resource.id}
          workspaceId={workspaceId}
          scheduleId={resource.id}
        />
      )

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

export function EmbeddedWorkflowActions({ workspaceId, workflowId }: EmbeddedWorkflowActionsProps) {
  const t = useTranslations('auto')
  const { navigateToSettings } = useSettingsNavigation()
  const { userPermissions: effectivePermissions } = useWorkspacePermissionsContext()
  const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)
  const { handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
  const isExecuting = useExecutionStore(
    (state) => state.workflowExecutions.get(workflowId)?.isExecuting ?? false
  )
  const { usageExceeded } = useUsageLimits()

  useEffect(() => {
    void setActiveWorkflow(workflowId)
  }, [workflowId, setActiveWorkflow])

  const isRunButtonDisabled =
    !isExecuting && !effectivePermissions.canRead && !effectivePermissions.isLoading

  const handleRun = async () => {
    setActiveWorkflow(workflowId)

    if (isExecuting) {
      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)
      await handleCancelExecution()
      await reportManualRunToolStop(workflowId, toolCallId)
      return
    }

    if (usageExceeded) {
      navigateToSettings({ section: 'billing' })
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
            aria-label={t('open_workflow')}
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('open_workflow')}</p>
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
  const t = useTranslations('auto')
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
          aria-label={t('open_knowledge_base')}
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{t('open_knowledge_base')}</p>
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
  const t = useTranslations('auto')
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
            aria-label={t('open_table')}
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('open_table')}</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleExport()}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label={t('export_table_as_csv')}
          >
            <Download className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('export_csv')}</p>
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
  const t = useTranslations('auto')
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
            aria-label={t('open_in_files')}
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('open_in_files')}</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleDownload()}
            disabled={!file}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label={t('download_file')}
          >
            <Download className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{t('download')}</p>
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
  const t = useTranslations('auto')
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
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{t('workflow_not_found')}</h2>
          <p className='text-[var(--text-body)] text-small'>
            {t('this_workflow_may_have_been_deleted')}
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
  previewMode?: PreviewMode
  streamingContent?: string
  isAgentEditing?: boolean
  streamIsIncremental?: boolean
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

function EmbeddedFile({
  workspaceId,
  fileId,
  filePath,
  previewMode,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: EmbeddedFileProps) {
  const t = useTranslations('auto')
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
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{t('file_not_found')}</h2>
          <p className='text-[var(--text-body)] text-small'>
            {t('this_file_may_have_been_deleted')}
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
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode}
        streamingContent={streamingContent}
        isAgentEditing={isAgentEditing}
        streamIsIncremental={streamIsIncremental}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
      />
    </div>
  )
}

interface EmbeddedFolderProps {
  workspaceId: string
  folderId: string
}

function EmbeddedFolder({ workspaceId, folderId }: EmbeddedFolderProps) {
  const t = useTranslations('auto')
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
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{t('folder_not_found')}</h2>
          <p className='text-[var(--text-body)] text-small'>
            {t('this_folder_may_have_been_deleted')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-y-auto p-6'>
      <h2 className='mb-4 font-medium text-[16px] text-[var(--text-primary)]'>{folder.name}</h2>
      {folderWorkflows.length === 0 ? (
        <p className='text-[13px] text-[var(--text-muted)]'>{t('no_workflows_in_this_folder')}</p>
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
  workspaceId: string
  scheduleId: string
}

function EmbeddedScheduledTask({ scheduleId }: EmbeddedScheduledTaskProps) {
  const t = useTranslations('auto')
  const { data: schedule, isLoading, isError } = useScheduleById(scheduleId)

  if (isLoading && !schedule) return LOADING_SKELETON

  if (!schedule) {
    const heading = isError ? "Couldn't load scheduled task" : 'Scheduled task not found'
    const detail = isError
      ? 'Something went wrong loading this scheduled task. Try again.'
      : 'This scheduled task may have been deleted'
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <Calendar className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{heading}</h2>
          <p className='text-[var(--text-body)] text-small'>{detail}</p>
        </div>
      </div>
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
        <ScheduledTaskField title={t('status')} value={status} />
        <ScheduledTaskField title={t('schedule')} value={timing} />
        <ScheduledTaskField title={t('next_run')} value={formatScheduleInstant(schedule.nextRunAt)} />
        <ScheduledTaskField title={t('last_run')} value={formatScheduleInstant(schedule.lastRanAt)} />
      </div>

      <div className='flex flex-col gap-1'>
        <span className='text-[var(--text-muted)] text-caption'>{t('prompt')}</span>
        <p className='whitespace-pre-wrap text-[var(--text-body)] text-small'>
          {schedule.prompt || '—'}
        </p>
      </div>

      {schedule.jobHistory && schedule.jobHistory.length > 0 && (
        <div className='flex flex-col gap-2'>
          <span className='text-[var(--text-muted)] text-caption'>{t('recent_runs')}</span>
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
  const t = useTranslations('auto')
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
          aria-label={t('open_in_scheduled_tasks')}
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{t('open_in_scheduled_tasks')}</p>
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
  const t = useTranslations('auto')
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
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{t('log_not_found')}</h2>
          <p className='text-[var(--text-body)] text-small'>
            {t('this_log_may_have_been_deleted')}
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
  const t = useTranslations('auto')
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
          aria-label={t('open_in_logs')}
        >
          <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{t('open_in_logs')}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
