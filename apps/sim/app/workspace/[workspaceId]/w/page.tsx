'use client'

import { useEffect, useMemo } from 'react'
import { Chip } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { ReactFlowProvider } from 'reactflow'
import { Panel, Terminal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { useWorkflowOperations } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useWorkflows } from '@/hooks/queries/workflows'

const logger = createLogger('WorkflowsPage')

function Spinner() {
  return (
    <div
      className='size-[18px] animate-spin rounded-full'
      style={{
        background:
          'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
        mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
        WebkitMask:
          'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
      }}
    />
  )
}

export default function WorkflowsPage() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: workflows = [], isLoading, isError, isPlaceholderData } = useWorkflows(workspaceId)
  const { handleCreateWorkflow, isCreatingWorkflow } = useWorkflowOperations({ workspaceId })

  const workspaceWorkflows = useMemo(
    () => workflows.filter((w) => w.workspaceId === workspaceId),
    [workflows, workspaceId]
  )
  const isResolving = isLoading || isPlaceholderData

  useEffect(() => {
    if (isResolving) return

    if (isError) {
      logger.error('Failed to load workflows for workspace')
      return
    }

    if (workspaceWorkflows.length > 0) {
      router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0].id}`)
    }
  }, [isResolving, isError, workspaceWorkflows, workspaceId, router])

  /**
   * A workspace can legitimately reach zero workflows — deleting the last one,
   * archiving them all, or creating a workspace with `skipDefaultWorkflow`. This
   * is the terminal state for those paths now that the chat composer is no
   * longer a landing option, so it has to offer a way out rather than spin.
   */
  const isEmpty = !isResolving && !isError && workspaceWorkflows.length === 0

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='relative h-full w-full flex-1 bg-[var(--bg)]'>
        <div className='workflow-container flex h-full items-center justify-center bg-[var(--bg)]'>
          {isEmpty ? (
            <div className='flex flex-col items-center gap-3 text-center text-[var(--text-secondary)]'>
              <div>
                <p className='font-medium text-small'>No workflows yet</p>
                <p className='mt-1 text-caption'>Create one to start building.</p>
              </div>
              <Chip onClick={handleCreateWorkflow} disabled={isCreatingWorkflow}>
                {isCreatingWorkflow ? 'Creating…' : 'Create workflow'}
              </Chip>
            </div>
          ) : (
            <Spinner />
          )}
        </div>
        <ReactFlowProvider>
          <Panel />
        </ReactFlowProvider>
      </div>
      <Terminal />
    </div>
  )
}
