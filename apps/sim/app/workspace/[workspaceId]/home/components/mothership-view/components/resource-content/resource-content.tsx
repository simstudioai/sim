'use client'

import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { Square } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button, PlayOutline, Skeleton, Tooltip } from '@/components/emcn'
import { BookOpen } from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import {
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/client-sse/run-tool-execution'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const Workflow = lazy(() => import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow'))

const LOADING_SKELETON = (
  <div className='flex h-full flex-col gap-[8px] p-[24px]'>
    <Skeleton className='h-[16px] w-[60%]' />
    <Skeleton className='h-[16px] w-[80%]' />
    <Skeleton className='h-[16px] w-[40%]' />
  </div>
)

interface ResourceContentProps {
  workspaceId: string
  resource: MothershipResource
  previewMode?: PreviewMode
}

/**
 * Renders the content for the currently active mothership resource.
 * Handles table, file, and workflow resource types with appropriate
 * embedded rendering for each.
 */
export function ResourceContent({ workspaceId, resource, previewMode }: ResourceContentProps) {
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
        />
      )

    case 'workflow':
      return (
        <Suspense fallback={LOADING_SKELETON}>
          <Workflow key={resource.id} workspaceId={workspaceId} workflowId={resource.id} embedded />
        </Suspense>
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
      markRunToolManuallyStopped(workflowId)
      await handleCancelExecution()
      await reportManualRunToolStop(workflowId)
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
    router.push(`/workspace/${workspaceId}/w/${workflowId}`)
  }, [router, workspaceId, workflowId])

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
            <WorkflowIcon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
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

interface EmbeddedFileProps {
  workspaceId: string
  fileId: string
  previewMode?: PreviewMode
}

function EmbeddedFile({ workspaceId, fileId, previewMode }: EmbeddedFileProps) {
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
      <FileViewer
        key={file.id}
        file={file}
        workspaceId={workspaceId}
        canEdit={true}
        previewMode={previewMode}
      />
    </div>
  )
}
