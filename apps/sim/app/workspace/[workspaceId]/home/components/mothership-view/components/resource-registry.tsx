'use client'

import { type ElementType, type ReactNode, Suspense, lazy } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Square } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'
import { Button, PlayOutline, Skeleton, Tooltip } from '@/components/emcn'
import { BookOpen, Database, File as FileIcon, SquareArrowUpRight, Table as TableIcon } from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { tableKeys } from '@/hooks/queries/tables'
import { workflowKeys } from '@/hooks/queries/workflows'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import {
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/client-sse/run-tool-execution'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const LazyWorkflow = lazy(() => import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow'))

const LOADING_SKELETON = (
  <div className='flex h-full flex-col gap-[8px] p-[24px]'>
    <Skeleton className='h-[16px] w-[60%]' />
    <Skeleton className='h-[16px] w-[80%]' />
    <Skeleton className='h-[16px] w-[40%]' />
  </div>
)

interface ContentProps {
  workspaceId: string
  resource: MothershipResource
  previewMode?: PreviewMode
}

interface ActionsProps {
  workspaceId: string
  resource: MothershipResource
}

interface DropdownItemRenderProps {
  item: { id: string; name: string; [key: string]: unknown }
}

export interface ResourceTypeConfig {
  type: MothershipResourceType
  label: string
  icon: ElementType
  renderTabIcon: (resource: MothershipResource, className: string) => ReactNode
  renderContent: (props: ContentProps) => ReactNode
  renderActions?: (props: ActionsProps) => ReactNode
  renderDropdownItem: (props: DropdownItemRenderProps) => ReactNode
}

function WorkflowTabSquare({ workflowId, className }: { workflowId: string; className?: string }) {
  const color = useWorkflowRegistry((state) => state.workflows[workflowId]?.color ?? '#888')
  return (
    <div
      className={cn('flex-shrink-0 rounded-[3px] border-[2px]', className)}
      style={{
        backgroundColor: color,
        borderColor: `${color}60`,
        backgroundClip: 'padding-box',
      }}
    />
  )
}

function WorkflowContent({ workspaceId, resource }: ContentProps) {
  return (
    <Suspense fallback={LOADING_SKELETON}>
      <LazyWorkflow key={resource.id} workspaceId={workspaceId} workflowId={resource.id} embedded />
    </Suspense>
  )
}

function WorkflowActions({ workspaceId, resource }: ActionsProps) {
  const router = useRouter()
  const { navigateToSettings } = useSettingsNavigation()
  const { userPermissions: effectivePermissions } = useWorkspacePermissionsContext()
  const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)
  const { handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
  const isExecuting = useExecutionStore(
    (state) => state.workflowExecutions.get(resource.id)?.isExecuting ?? false
  )
  const { usageExceeded } = useUsageLimits()

  useEffect(() => {
    setActiveWorkflow(resource.id)
  }, [setActiveWorkflow, resource.id])

  const isRunButtonDisabled =
    !isExecuting && !effectivePermissions.canRead && !effectivePermissions.isLoading

  const handleRun = useCallback(async () => {
    setActiveWorkflow(resource.id)

    if (isExecuting) {
      markRunToolManuallyStopped(resource.id)
      await handleCancelExecution()
      await reportManualRunToolStop(resource.id)
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
    resource.id,
  ])

  const handleOpenWorkflow = useCallback(() => {
    router.push(`/workspace/${workspaceId}/w/${resource.id}`)
  }, [router, workspaceId, resource.id])

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={handleOpenWorkflow}
            className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
            aria-label='Open workflow'
          >
            <SquareArrowUpRight className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Open Workflow</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={() => void handleRun()}
            disabled={isRunButtonDisabled}
            className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
            aria-label={isExecuting ? 'Stop workflow' : 'Run workflow'}
          >
            {isExecuting ? (
              <Square className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            ) : (
              <PlayOutline className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            )}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>{isExecuting ? 'Stop' : 'Run'}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </>
  )
}

function WorkflowDropdownItem({ item }: DropdownItemRenderProps) {
  const color = (item.color as string) ?? '#888'
  return (
    <>
      <div
        className='mr-[0px] h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: `${color}60`,
          backgroundClip: 'padding-box',
        }}
      />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function TableContent({ workspaceId, resource }: ContentProps) {
  return <Table key={resource.id} workspaceId={workspaceId} tableId={resource.id} embedded />
}

function DefaultDropdownItem({ item }: DropdownItemRenderProps) {
  return <span className='truncate'>{item.name}</span>
}

function FileContent({ workspaceId, resource, previewMode }: ContentProps) {
  return (
    <EmbeddedFile
      key={resource.id}
      workspaceId={workspaceId}
      fileId={resource.id}
      previewMode={previewMode}
    />
  )
}

function EmbeddedFile({ workspaceId, fileId, previewMode }: { workspaceId: string; fileId: string; previewMode?: PreviewMode }) {
  const { data: files = [], isLoading } = useWorkspaceFiles(workspaceId)
  const file = useMemo(() => files.find((f) => f.id === fileId), [files, fileId])

  if (isLoading) return LOADING_SKELETON

  if (!file) {
    return (
      <div className='flex h-full items-center justify-center'>
        <span className='text-[13px] text-[var(--text-muted)]'>File not found</span>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <FileViewer key={file.id} file={file} workspaceId={workspaceId} canEdit={true} previewMode={previewMode} />
    </div>
  )
}

function FileDropdownItem({ item }: DropdownItemRenderProps) {
  const DocIcon = getDocumentIcon('', item.name)
  return (
    <>
      <DocIcon className='mr-[8px] h-[14px] w-[14px] text-[var(--text-icon)]' />
      <span className='truncate'>{item.name}</span>
    </>
  )
}

function KnowledgeBaseContent({ workspaceId, resource }: ContentProps) {
  return (
    <KnowledgeBase
      key={resource.id}
      id={resource.id}
      knowledgeBaseName={resource.title}
      workspaceId={workspaceId}
    />
  )
}

function KnowledgeBaseActions({ workspaceId, resource }: ActionsProps) {
  const router = useRouter()

  const handleOpen = useCallback(() => {
    router.push(`/workspace/${workspaceId}/knowledge/${resource.id}`)
  }, [router, workspaceId, resource.id])

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={handleOpen}
          className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
          aria-label='Open knowledge base'
        >
          <BookOpen className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Open Knowledge Base</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export const RESOURCE_REGISTRY: Record<MothershipResourceType, ResourceTypeConfig> = {
  workflow: {
    type: 'workflow',
    label: 'Workflows',
    icon: WorkflowIcon,
    renderTabIcon: (resource, className) => (
      <WorkflowTabSquare workflowId={resource.id} className={className} />
    ),
    renderContent: (props) => <WorkflowContent {...props} />,
    renderActions: (props) => <WorkflowActions {...props} />,
    renderDropdownItem: (props) => <WorkflowDropdownItem {...props} />,
  },
  table: {
    type: 'table',
    label: 'Tables',
    icon: TableIcon,
    renderTabIcon: (_resource, className) => <TableIcon className={cn(className, 'text-[var(--text-icon)]')} />,
    renderContent: (props) => <TableContent {...props} />,
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
  },
  file: {
    type: 'file',
    label: 'Files',
    icon: FileIcon,
    renderTabIcon: (resource, className) => {
      const DocIcon = getDocumentIcon('', resource.title)
      return <DocIcon className={cn(className, 'text-[var(--text-icon)]')} />
    },
    renderContent: (props) => <FileContent {...props} />,
    renderDropdownItem: (props) => <FileDropdownItem {...props} />,
  },
  knowledgebase: {
    type: 'knowledgebase',
    label: 'Knowledge Bases',
    icon: Database,
    renderTabIcon: (_resource, className) => <Database className={cn(className, 'text-[var(--text-icon)]')} />,
    renderContent: (props) => <KnowledgeBaseContent {...props} />,
    renderActions: (props) => <KnowledgeBaseActions {...props} />,
    renderDropdownItem: (props) => <DefaultDropdownItem {...props} />,
  },
} as const

export const RESOURCE_TYPES = Object.values(RESOURCE_REGISTRY)

export function getResourceConfig(type: MothershipResourceType): ResourceTypeConfig {
  return RESOURCE_REGISTRY[type]
}

// ---------------------------------------------------------------------------
// Resource query invalidation
// ---------------------------------------------------------------------------

const RESOURCE_INVALIDATORS: Record<
  MothershipResourceType,
  (qc: QueryClient, workspaceId: string, resourceId: string) => void
> = {
  table: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: tableKeys.list(wId) })
    qc.invalidateQueries({ queryKey: tableKeys.detail(id) })
  },
  file: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.list(wId) })
    qc.invalidateQueries({ queryKey: workspaceFilesKeys.content(wId, id) })
  },
  workflow: (qc, wId) => {
    qc.invalidateQueries({ queryKey: workflowKeys.list(wId) })
  },
  knowledgebase: (qc, wId, id) => {
    qc.invalidateQueries({ queryKey: knowledgeKeys.list(wId) })
    qc.invalidateQueries({ queryKey: knowledgeKeys.detail(id) })
  },
}

/**
 * Invalidate list and detail queries for a specific resource.
 * Called when a `resource_added` event arrives so the embedded view refreshes
 * and the add-resource dropdown stays up to date.
 */
export function invalidateResourceQueries(
  queryClient: QueryClient,
  workspaceId: string,
  resourceType: MothershipResourceType,
  resourceId: string
): void {
  RESOURCE_INVALIDATORS[resourceType](queryClient, workspaceId, resourceId)
}
