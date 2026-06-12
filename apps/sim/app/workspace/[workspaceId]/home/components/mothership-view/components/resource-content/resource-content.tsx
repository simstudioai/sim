'use client'

import { lazy, memo, Suspense, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { stripVersionSuffix } from '@sim/utils/string'
import { Button, PlayOutline, Skeleton, Tooltip } from '@/components/emcn'
import {
  Connections,
  Download,
  FileX,
  Folder as FolderIcon,
  Library,
  Square,
  Workflow as WorkflowIcon,
  WorkflowX,
} from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { isApiClientError } from '@/lib/api/client/errors'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import {
  cancelRunToolExecution,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { INTEGRATIONS, type Integration } from '@/lib/integrations'
import { triggerFileDownload } from '@/lib/uploads/client/download'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  FileViewer,
  type PreviewMode,
  resolveFileCategory,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  PANEL_ICON_BUTTON_CLASS,
  PANEL_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-controls'
import { GenericResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/generic-resource-content'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
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
import { downloadTableExport } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const Workflow = lazy(() => import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow'))

const Tables = lazy(() =>
  import('@/app/workspace/[workspaceId]/tables/tables').then((m) => ({ default: m.Tables }))
)
const Files = lazy(() =>
  import('@/app/workspace/[workspaceId]/files/files').then((m) => ({ default: m.Files }))
)
const Knowledge = lazy(() =>
  import('@/app/workspace/[workspaceId]/knowledge/knowledge').then((m) => ({
    default: m.Knowledge,
  }))
)
const Logs = lazy(() => import('@/app/workspace/[workspaceId]/logs/logs'))
const ScheduledTasks = lazy(() =>
  import('@/app/workspace/[workspaceId]/scheduled-tasks/scheduled-tasks').then((m) => ({
    default: m.ScheduledTasks,
  }))
)
const IntegrationBlockDetail = lazy(() =>
  import('@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail').then(
    (m) => ({ default: m.IntegrationBlockDetail })
  )
)

/**
 * Resolves an integration catalog entry from a resource tab id (the block's
 * registry type). Catalog types may carry version suffixes (`gmail_v2`) while
 * tab ids may use base types, so both forms are matched.
 */
function findIntegrationByBlockType(blockType: string): Integration | undefined {
  return INTEGRATIONS.find(
    (i) => i.type === blockType || stripVersionSuffix(i.type) === stripVersionSuffix(blockType)
  )
}

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
  onNotFound?: (resourceId: string) => void
  /** Opens another resource as a tab (used by embedded pages to open details in-panel). */
  onAddResource?: (resource: MothershipResource) => void
}

/**
 * Renders the content for the currently active mothership resource.
 * Each persistable resource type gets an embedded view (table, file,
 * workflow, knowledge base, folder, file folder, log, integration, page);
 * types without one fall back to an explanatory placeholder panel.
 */
const STREAMING_EPOCH = new Date(0)

export const ResourceContent = memo(function ResourceContent({
  workspaceId,
  resource,
  previewMode,
  previewSession,
  genericResourceData,
  previewContextKey,
  onNotFound,
  onAddResource,
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
  const isTextPreview =
    !!previewSession && resolveFileCategory(null, previewSession.fileName) === 'text-editable'
  const textStreamingContent =
    isTextPreview &&
    typeof previewSession?.previewText === 'string' &&
    hasRenderableFilePreviewContent(previewSession)
      ? previewSession.previewText
      : undefined

  if (resource.id === 'streaming-file') {
    return (
      <div className='flex h-full flex-col overflow-hidden'>
        <FileViewer
          file={syntheticFile}
          workspaceId={workspaceId}
          canEdit={false}
          previewMode={previewMode ?? 'preview'}
          streamingContent={textStreamingContent}
          streamingMode='replace'
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
          streamingMode='replace'
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

    case 'filefolder':
      return (
        <EmbeddedFileFolder
          key={resource.id}
          workspaceId={workspaceId}
          folderId={resource.id}
          onAddResource={onAddResource}
        />
      )

    case 'integration':
      return (
        <EmbeddedIntegration key={resource.id} workspaceId={workspaceId} blockType={resource.id} />
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

    case 'page':
      return <EmbeddedPage key={resource.id} pageId={resource.id} onAddResource={onAddResource} />

    case 'generic':
      return (
        <GenericResourceContent key={resource.id} data={genericResourceData ?? { entries: [] }} />
      )

    default:
      return <UnsupportedResourceContent key={resource.id} resource={resource} />
  }
})

interface UnsupportedResourceContentProps {
  resource: MothershipResource
}

/**
 * Fallback for persisted tabs whose type has no embedded view (e.g. legacy
 * `task` tabs). Shown instead of a blank panel so the tab stays explainable
 * and removable.
 */
function UnsupportedResourceContent({ resource }: UnsupportedResourceContentProps) {
  const Icon = getResourceConfig(resource.type).icon
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3'>
      <Icon className='size-[32px] text-[var(--text-icon)]' />
      <div className='flex flex-col items-center gap-1'>
        <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{resource.title}</h2>
        <p className='text-[var(--text-body)] text-small'>
          This resource doesn't have an embedded view
        </p>
      </div>
    </div>
  )
}

interface EmbeddedPageProps {
  pageId: string
  onAddResource?: (resource: MothershipResource) => void
}

/**
 * Renders a workspace area page (Tables, Knowledge Base, Logs, Scheduled
 * Tasks) inside the chat's resource panel. Detail navigation is intercepted
 * where the standalone page would route away: opening a table or knowledge
 * base adds it as a sibling resource tab instead.
 */
function EmbeddedPage({ pageId, onAddResource }: EmbeddedPageProps) {
  const content = (() => {
    switch (pageId) {
      case 'tables':
        return (
          <Tables
            onOpenTable={(tableId, tableName) =>
              onAddResource?.({ type: 'table', id: tableId, title: tableName })
            }
          />
        )
      case 'files':
        return (
          <Files
            embedded
            onOpenFile={(fileId, fileName) =>
              onAddResource?.({ type: 'file', id: fileId, title: fileName })
            }
          />
        )
      case 'knowledge':
        return (
          <Knowledge
            onOpenKnowledgeBase={(knowledgeBaseId, knowledgeBaseName) =>
              onAddResource?.({
                type: 'knowledgebase',
                id: knowledgeBaseId,
                title: knowledgeBaseName,
              })
            }
          />
        )
      case 'logs':
        return <Logs />
      case 'scheduled-tasks':
        return <ScheduledTasks />
      default:
        return null
    }
  })()

  if (!content) return null

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <Suspense fallback={LOADING_SKELETON}>{content}</Suspense>
    </div>
  )
}

interface ResourceActionsProps {
  workspaceId: string
  resource: MothershipResource
}

/**
 * Per-type panel actions. Open-in-page controls were retired: collapsing the
 * chat pane gives the same full-page view without losing context, so only
 * genuinely additive actions (run, export, download) remain.
 */
export function ResourceActions({ workspaceId, resource }: ResourceActionsProps) {
  switch (resource.type) {
    case 'workflow':
      return <EmbeddedWorkflowActions workflowId={resource.id} />
    case 'file':
      return (
        <EmbeddedFileActions
          workspaceId={workspaceId}
          fileId={resource.id}
          filePath={resource.path}
        />
      )
    case 'table':
      return <EmbeddedTableActions tableId={resource.id} tableName={resource.title} />
    default:
      return null
  }
}

interface EmbeddedWorkflowActionsProps {
  workflowId: string
}

function EmbeddedWorkflowActions({ workflowId }: EmbeddedWorkflowActionsProps) {
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

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={() => void handleRun()}
          disabled={isRunButtonDisabled}
          className={PANEL_ICON_BUTTON_CLASS}
          aria-label={isExecuting ? 'Stop workflow' : 'Run workflow'}
        >
          {isExecuting ? (
            <Square className={PANEL_ICON_CLASS} />
          ) : (
            <PlayOutline className={PANEL_ICON_CLASS} />
          )}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{isExecuting ? 'Stop' : 'Run workflow'}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const tableLogger = createLogger('EmbeddedTableActions')

interface EmbeddedTableActionsProps {
  tableId: string
  tableName: string
}

function EmbeddedTableActions({ tableId, tableName }: EmbeddedTableActionsProps) {
  const handleExport = async () => {
    try {
      await downloadTableExport(tableId, tableName)
    } catch (err) {
      tableLogger.error('Failed to export table:', err)
    }
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={() => void handleExport()}
          className={PANEL_ICON_BUTTON_CLASS}
          aria-label='Export table as CSV'
        >
          <Download className={PANEL_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Export CSV</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const fileLogger = createLogger('EmbeddedFileActions')

interface EmbeddedFileActionsProps {
  workspaceId: string
  fileId: string
  filePath?: string
}

function EmbeddedFileActions({ workspaceId, fileId, filePath }: EmbeddedFileActionsProps) {
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

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={() => void handleDownload()}
          disabled={!file}
          className={PANEL_ICON_BUTTON_CLASS}
          aria-label='Download file'
        >
          <Download className={PANEL_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Download</p>
      </Tooltip.Content>
    </Tooltip.Root>
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
  filePath?: string
  previewMode?: PreviewMode
  streamingContent?: string
  streamingMode?: 'append' | 'replace'
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

function EmbeddedFile({
  workspaceId,
  fileId,
  filePath,
  previewMode,
  streamingContent,
  streamingMode,
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

  const folder = (folderList ?? []).find((f) => f.id === folderId)
  const folderWorkflows = workflowList.filter((w) => w.folderId === folderId)

  if (isFoldersPending) return LOADING_SKELETON

  if (!folder) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FolderIcon className='size-[32px] text-[var(--text-icon)]' />
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
              <WorkflowIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='truncate text-[13px] text-[var(--text-primary)]'>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface EmbeddedFileFolderProps {
  workspaceId: string
  folderId: string
  onAddResource?: (resource: MothershipResource) => void
}

/**
 * Lists a workspace file folder's subfolders and files inside the resource
 * panel. Selecting an entry opens it as a sibling resource tab rather than
 * navigating away from the chat.
 */
function EmbeddedFileFolder({ workspaceId, folderId, onAddResource }: EmbeddedFileFolderProps) {
  const { data: folderList, isPending: isFoldersPending } = useWorkspaceFileFolders(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)

  const folder = (folderList ?? []).find((f) => f.id === folderId)
  const subfolders = (folderList ?? []).filter((f) => f.parentId === folderId)
  const folderFiles = files.filter((f) => f.folderId === folderId)

  if (isFoldersPending) return LOADING_SKELETON

  if (!folder) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FolderIcon className='size-[32px] text-[var(--text-icon)]' />
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
      {subfolders.length === 0 && folderFiles.length === 0 ? (
        <p className='text-[13px] text-[var(--text-muted)]'>This folder is empty</p>
      ) : (
        <div className='flex flex-col gap-1'>
          {subfolders.map((sub) => (
            <button
              key={sub.id}
              type='button'
              onClick={() => onAddResource?.({ type: 'filefolder', id: sub.id, title: sub.name })}
              className='flex items-center gap-2 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-4)]'
            >
              <FolderIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='truncate text-[13px] text-[var(--text-primary)]'>{sub.name}</span>
            </button>
          ))}
          {folderFiles.map((file) => {
            const DocIcon = getDocumentIcon('', file.name)
            return (
              <button
                key={file.id}
                type='button'
                onClick={() => onAddResource?.({ type: 'file', id: file.id, title: file.name })}
                className='flex items-center gap-2 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-4)]'
              >
                <DocIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='truncate text-[13px] text-[var(--text-primary)]'>{file.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface EmbeddedIntegrationProps {
  workspaceId: string
  blockType: string
}

/**
 * Renders the integration catalog detail page for an integration resource tab,
 * minus the full-page back-link chrome.
 */
function EmbeddedIntegration({ workspaceId, blockType }: EmbeddedIntegrationProps) {
  const integration = useMemo(() => findIntegrationByBlockType(blockType), [blockType])

  if (!integration) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <Connections className='size-[32px] text-[var(--text-icon)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>
            Integration not found
          </h2>
          <p className='text-[var(--text-body)] text-small'>
            This integration may no longer be available
          </p>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={LOADING_SKELETON}>
      <IntegrationBlockDetail integration={integration} workspaceId={workspaceId} embedded />
    </Suspense>
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
          <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>Log not found</h2>
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
