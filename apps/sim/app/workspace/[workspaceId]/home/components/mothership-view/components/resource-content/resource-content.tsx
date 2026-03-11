'use client'

import { lazy, Suspense, useMemo } from 'react'
import { Skeleton } from '@/components/emcn'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import type { ExecutionResult } from '@/executor/types'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

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
  onWorkflowRunComplete?: (workflowName: string, result: ExecutionResult) => Promise<void>
}

/**
 * Renders the content for the currently active mothership resource.
 * Handles table, file, and workflow resource types with appropriate
 * embedded rendering for each.
 */
export function ResourceContent({
  workspaceId,
  resource,
  previewMode,
  onWorkflowRunComplete,
}: ResourceContentProps) {
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
          <Workflow
            key={resource.id}
            workspaceId={workspaceId}
            workflowId={resource.id}
            embedded
            onManualRunComplete={
              onWorkflowRunComplete
                ? (result) => onWorkflowRunComplete(resource.title, result)
                : undefined
            }
          />
        </Suspense>
      )

    default:
      return null
  }
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
