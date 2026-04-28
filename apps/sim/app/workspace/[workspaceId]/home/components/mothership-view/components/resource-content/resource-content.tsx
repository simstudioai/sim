'use client'

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { formatDuration } from '@sim/utils/formatting'
import { Square } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button, Eye, PlayOutline, Skeleton, Tooltip } from '@/components/emcn'
import {
  Download,
  FileX,
  Folder as FolderIcon,
  Library,
  SquareArrowUpRight,
  WorkflowX,
} from '@/components/emcn/icons'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  cancelRunToolExecution,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { cn } from '@/lib/core/utils/cn'
import { filterHiddenOutputKeys } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  downloadWorkspaceFile,
  getFileExtension,
  getMimeTypeFromExtension,
} from '@/lib/uploads/utils/file-utils'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { GenericResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/generic-resource-content'
import {
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import {
  ExecutionSnapshot,
  FileCards,
  TraceSpans,
  WorkflowOutputSection,
} from '@/app/workspace/[workspaceId]/logs/components'
import {
  formatDate,
  getDisplayStatus,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail } from '@/hooks/queries/logs'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { formatCost } from '@/providers/utils'
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

interface ResourceContentProps {
  workspaceId: string
  resource: MothershipResource
  previewMode?: PreviewMode
  previewSession?: FilePreviewSession | null
  genericResourceData?: GenericResourceData
  previewContextKey?: string
}

/**
 * Renders the content for the currently active mothership resource.
 * Handles table, file, and workflow resource types with appropriate
 * embedded rendering for each.
 */
const STREAMING_EPOCH = new Date(0)

export const ResourceContent = memo(function ResourceContent({
  workspaceId,
  resource,
  previewMode,
  previewSession,
  genericResourceData,
  previewContextKey,
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

  const streamingFileMode: 'append' | 'replace' = 'replace'
  const disableStreamingAutoScroll = previewSession?.operation === 'patch'
  const rawPreviewText = previewSession?.previewText
  const streamingPreviewText =
    typeof rawPreviewText === 'string' && rawPreviewText.length > 0 ? rawPreviewText : undefined

  if (previewSession && resource.id === 'streaming-file') {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        {streamingPreviewText !== undefined ? (
          <FileViewer
            file={syntheticFile}
            workspaceId={workspaceId}
            canEdit={false}
            previewMode={previewMode ?? 'preview'}
            streamingContent={streamingPreviewText}
            streamingMode={streamingFileMode}
            disableStreamingAutoScroll={disableStreamingAutoScroll}
            previewContextKey={previewContextKey}
            useCodeRendererForCodeFiles
          />
        ) : (
          <div className='flex h-full items-center justify-center'>
            <p className='text-[13px] text-[var(--text-muted)]'>Processing file...</p>
          </div>
        )}
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
          previewMode={previewMode}
          streamingContent={
            previewSession?.fileId === resource.id ? streamingPreviewText : undefined
          }
          streamingMode={streamingFileMode}
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
      return <EmbeddedLog key={resource.id} logId={resource.id} />

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
      return <EmbeddedFileActions workspaceId={workspaceId} fileId={resource.id} />
    case 'knowledgebase':
      return (
        <EmbeddedKnowledgeBaseActions workspaceId={workspaceId} knowledgeBaseId={resource.id} />
      )
    case 'log':
      return <EmbeddedLogActions workspaceId={workspaceId} logId={resource.id} />
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
  const router = useRouter()
  const { navigateToSettings } = useSettingsNavigation()
  const { userPermissions: effectivePermissions } = useWorkspacePermissionsContext()
  const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)
  const { handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
  const isExecuting = useExecutionStore(
    (state) => state.workflowExecutions.get(workflowId)?.isExecuting ?? false
  )
  const { usageExceeded } = useUsageLimits()

  useEffect(() => {
    setActiveWorkflow(workflowId)
  }, [setActiveWorkflow, workflowId])

  const isRunButtonDisabled =
    !isExecuting && !effectivePermissions.canRead && !effectivePermissions.isLoading

  const handleRun = useCallback(async () => {
    setActiveWorkflow(workflowId)

    if (isExecuting) {
      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)
      await handleCancelExecution()
      await reportManualRunToolStop(workflowId, toolCallId)
      return
    }

    if (usageExceeded) {
      navigateToSettings({ section: 'subscription' })
      return
    }

    await handleRunWorkflow()
  }, [
    handleCancelExecution,
    handleRunWorkflow,
    isExecuting,
    navigateToSettings,
    setActiveWorkflow,
    usageExceeded,
    workflowId,
  ])

  const handleOpenWorkflow = useCallback(() => {
    window.open(`/workspace/${workspaceId}/w/${workflowId}`, '_blank')
  }, [workspaceId, workflowId])

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

  const handleOpenKnowledgeBase = useCallback(() => {
    router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`)
  }, [router, workspaceId, knowledgeBaseId])

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

const fileLogger = createLogger('EmbeddedFileActions')

interface EmbeddedFileActionsProps {
  workspaceId: string
  fileId: string
}

function EmbeddedFileActions({ workspaceId, fileId }: EmbeddedFileActionsProps) {
  const router = useRouter()
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const file = useMemo(() => files.find((f) => f.id === fileId), [files, fileId])

  const handleDownload = useCallback(async () => {
    if (!file) return
    try {
      await downloadWorkspaceFile(file)
    } catch (err) {
      fileLogger.error('Failed to download file:', err)
    }
  }, [file])

  const handleOpenInFiles = useCallback(() => {
    router.push(`/workspace/${workspaceId}/files/${encodeURIComponent(fileId)}`)
  }, [router, workspaceId, fileId])

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
  const workflowExists = useMemo(
    () => (workflowList ?? []).some((w) => w.id === workflowId),
    [workflowList, workflowId]
  )
  const hasLoadError = useWorkflowRegistry(
    (state) => state.hydration.phase === 'error' && state.hydration.workflowId === workflowId
  )

  if (isWorkflowsPending) return LOADING_SKELETON

  if (!workflowExists || hasLoadError) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <WorkflowX className='h-[32px] w-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>Workflow not found</h2>
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
  previewMode?: PreviewMode
  streamingContent?: string
  streamingMode?: 'append' | 'replace'
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

function EmbeddedFile({
  workspaceId,
  fileId,
  previewMode,
  streamingContent,
  streamingMode,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: EmbeddedFileProps) {
  const { canEdit } = useUserPermissionsContext()
  const { data: files = [], isLoading, isFetching } = useWorkspaceFiles(workspaceId)
  const file = useMemo(() => files.find((f) => f.id === fileId), [files, fileId])

  if (isLoading || (isFetching && !file)) return LOADING_SKELETON

  if (!file) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FileX className='h-[32px] w-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>File not found</h2>
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
        workspaceId={workspaceId}
        canEdit={canEdit}
        streamingMode={streamingMode}
        previewMode={previewMode}
        streamingContent={streamingContent}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
        useCodeRendererForCodeFiles
      />
    </div>
  )
}

interface EmbeddedFolderProps {
  workspaceId: string
  folderId: string
}

function EmbeddedFolder({ workspaceId, folderId }: EmbeddedFolderProps) {
  const { data: folderList, isPending: isFoldersPending } = useFolders(workspaceId)
  const { data: workflowList = [] } = useWorkflows(workspaceId)

  const folder = useMemo(
    () => (folderList ?? []).find((f) => f.id === folderId),
    [folderList, folderId]
  )

  const folderWorkflows = useMemo(
    () => workflowList.filter((w) => w.folderId === folderId),
    [workflowList, folderId]
  )

  if (isFoldersPending) return LOADING_SKELETON

  if (!folder) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FolderIcon className='h-[32px] w-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>Folder not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This folder may have been deleted or moved
          </p>
        </div>
      </div>
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
              <div
                className='h-[12px] w-[12px] flex-shrink-0 rounded-[3px] border-[2px]'
                style={{
                  backgroundColor: w.color,
                  borderColor: workflowBorderColor(w.color),
                  backgroundClip: 'padding-box',
                }}
              />
              <span className='truncate text-[13px] text-[var(--text-primary)]'>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface EmbeddedLogProps {
  logId: string
}

function EmbeddedLog({ logId }: EmbeddedLogProps) {
  const { data: log, isLoading } = useLogDetail(logId)
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false)

  const logStatus = getDisplayStatus(log?.status)

  const workflowOutput = useMemo(() => {
    const executionData = log?.executionData as
      | { finalOutput?: Record<string, unknown> }
      | undefined
    if (!executionData?.finalOutput) return null
    return filterHiddenOutputKeys(executionData.finalOutput) as Record<string, unknown>
  }, [log?.executionData])

  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    return (
      (log.trigger === 'manual' && !!log.duration) ||
      (log.executionData?.enhanced && log.executionData?.traceSpans)
    )
  }, [log])

  const hasCostInfo = isWorkflowExecutionLog && log?.cost

  const formattedTimestamp = useMemo(
    () => (log ? formatDate(log.createdAt) : null),
    [log?.createdAt]
  )

  if (isLoading) return LOADING_SKELETON

  if (!log) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <Library className='h-[32px] w-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>Log not found</h2>
          <p className='text-[var(--text-body)] text-small'>
            This log may have been deleted or is no longer available
          </p>
        </div>
      </div>
    )
  }

  const workflowColor =
    log.trigger === 'mothership'
      ? '#ec4899'
      : log.workflow?.color || (!log.workflowId ? 'var(--text-tertiary)' : undefined)

  const totalToolCost = (() => {
    const models = (log.cost as Record<string, unknown>)?.models as
      | Record<string, { toolCost?: number }>
      | undefined
    return models ? Object.values(models).reduce((sum, m) => sum + (m?.toolCost || 0), 0) : 0
  })()

  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      <div className='flex flex-col gap-2.5 p-4 pb-6'>
        {/* Timestamp & Workflow Row */}
        <div className='flex min-w-0 items-center gap-4 px-[1px]'>
          <div className='flex w-[140px] flex-shrink-0 flex-col gap-2'>
            <div className='font-medium text-[var(--text-tertiary)] text-caption'>Timestamp</div>
            <div className='flex items-center gap-1.5'>
              <span className='font-medium text-[var(--text-secondary)] text-sm'>
                {formattedTimestamp?.compactDate || 'N/A'}
              </span>
              <span className='font-medium text-[var(--text-secondary)] text-sm'>
                {formattedTimestamp?.compactTime || 'N/A'}
              </span>
            </div>
          </div>
          <div className='flex w-0 min-w-0 flex-1 flex-col gap-2'>
            <div className='font-medium text-[var(--text-tertiary)] text-caption'>
              {log.trigger === 'mothership' ? 'Job' : 'Workflow'}
            </div>
            <div className='flex min-w-0 items-center gap-2'>
              <div
                className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px] border-[1.5px]'
                style={{
                  backgroundColor: workflowColor,
                  borderColor: workflowColor ? workflowBorderColor(workflowColor) : undefined,
                  backgroundClip: 'padding-box',
                }}
              />
              <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)] text-sm'>
                {log.trigger === 'mothership'
                  ? log.jobTitle || 'Untitled Job'
                  : log.workflow?.name || (!log.workflowId ? 'Deleted Workflow' : 'Unknown')}
              </span>
            </div>
          </div>
        </div>

        {/* Run ID */}
        {log.executionId && (
          <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2'>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>Run ID</span>
            <span className='truncate font-medium text-[var(--text-secondary)] text-sm'>
              {log.executionId}
            </span>
          </div>
        )}

        {/* Details Section */}
        <div className='-my-1 flex min-w-0 flex-col overflow-hidden'>
          <div className='flex h-[48px] items-center justify-between border-[var(--border)] border-b p-2'>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>Level</span>
            <StatusBadge status={logStatus} />
          </div>
          <div className='flex h-[48px] items-center justify-between border-[var(--border)] border-b p-2'>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>Trigger</span>
            {log.trigger ? (
              <TriggerBadge trigger={log.trigger} />
            ) : (
              <span className='font-medium text-[var(--text-secondary)] text-caption'>—</span>
            )}
          </div>
          <div
            className={cn(
              'flex h-[48px] items-center justify-between border-b p-2',
              log.deploymentVersion ? 'border-[var(--border)]' : 'border-transparent'
            )}
          >
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>Duration</span>
            <span className='font-medium text-[var(--text-secondary)] text-small'>
              {formatDuration(log.duration, { precision: 2 }) || '—'}
            </span>
          </div>
          {log.deploymentVersion && (
            <div className='flex h-[48px] items-center gap-2 p-2'>
              <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
                Version
              </span>
              <div className='flex w-0 flex-1 justify-end'>
                <span className='max-w-full truncate rounded-md bg-[var(--badge-success-bg)] px-[9px] py-0.5 font-medium text-[var(--badge-success-text)] text-caption'>
                  {log.deploymentVersionName || `v${log.deploymentVersion}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Workflow State Snapshot */}
        {isWorkflowExecutionLog && log.executionId && log.trigger !== 'mothership' && (
          <div className='-mt-2 flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2'>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>
              Workflow State
            </span>
            <Button
              variant='active'
              onClick={() => setIsSnapshotOpen(true)}
              className='flex w-full items-center justify-between px-2.5 py-1.5'
            >
              <span className='font-medium text-caption'>View Snapshot</span>
              <Eye className='h-[14px] w-[14px]' />
            </Button>
          </div>
        )}

        {/* Workflow Output */}
        {isWorkflowExecutionLog && workflowOutput && (
          <div className='mt-1 flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
            <span
              className={cn(
                'font-medium text-caption',
                workflowOutput.error ? 'text-[var(--text-error)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              Workflow Output
            </span>
            <WorkflowOutputSection output={workflowOutput} />
          </div>
        )}

        {/* Trace Spans */}
        {isWorkflowExecutionLog && log.executionData?.traceSpans && (
          <div className='mt-1 flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>Trace Span</span>
            <TraceSpans traceSpans={log.executionData.traceSpans} />
          </div>
        )}

        {/* Files */}
        {log.files && log.files.length > 0 && <FileCards files={log.files} isExecutionFile />}

        {/* Cost Breakdown */}
        {hasCostInfo && (
          <div className='flex flex-col gap-2'>
            <span className='px-[1px] font-medium text-[var(--text-tertiary)] text-caption'>
              Cost Breakdown
            </span>
            <div className='flex flex-col gap-1 rounded-md border border-[var(--border)]'>
              <div className='flex flex-col gap-2.5 rounded-md p-2.5'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Base Execution:
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    {formatCost(BASE_EXECUTION_CHARGE)}
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Model Input:
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    {formatCost(log.cost?.input || 0)}
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Model Output:
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    {formatCost(log.cost?.output || 0)}
                  </span>
                </div>
                {totalToolCost > 0 && (
                  <div className='flex items-center justify-between'>
                    <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                      Tool Usage:
                    </span>
                    <span className='font-medium text-[var(--text-secondary)] text-caption'>
                      {formatCost(totalToolCost)}
                    </span>
                  </div>
                )}
              </div>
              <div className='border-[var(--border)] border-t' />
              <div className='flex flex-col gap-2.5 rounded-md p-2.5'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Total:
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    {formatCost(log.cost?.total || 0)}
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                    Tokens:
                  </span>
                  <span className='font-medium text-[var(--text-secondary)] text-caption'>
                    {log.cost?.tokens?.input || log.cost?.tokens?.prompt || 0} in /{' '}
                    {log.cost?.tokens?.output || log.cost?.tokens?.completion || 0} out
                  </span>
                </div>
              </div>
            </div>
            <div className='flex items-center justify-center rounded-md bg-[var(--surface-2)] p-2 text-center'>
              <p className='font-medium text-[var(--text-subtle)] text-xs'>
                Total cost includes a base execution charge of {formatCost(BASE_EXECUTION_CHARGE)}{' '}
                plus any model and tool usage costs.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Frozen Canvas Modal */}
      {log.executionId && (
        <ExecutionSnapshot
          executionId={log.executionId}
          traceSpans={log.executionData?.traceSpans}
          isModal
          isOpen={isSnapshotOpen}
          onClose={() => setIsSnapshotOpen(false)}
        />
      )}
    </div>
  )
}

interface EmbeddedLogActionsProps {
  workspaceId: string
  logId: string
}

export function EmbeddedLogActions({ workspaceId, logId }: EmbeddedLogActionsProps) {
  const router = useRouter()
  const { data: log } = useLogDetail(logId)

  const handleOpenInLogs = useCallback(() => {
    const param = log?.executionId ? `?executionId=${log.executionId}` : ''
    router.push(`/workspace/${workspaceId}/logs${param}`)
  }, [router, workspaceId, log?.executionId])

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
