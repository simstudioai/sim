'use client'

import { useEffect } from 'react'
import { Chip } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { ReactFlowProvider } from 'reactflow'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
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
          'conic-gradient(from 0deg, var(--text-icon) 0deg 120deg, transparent 120deg 180deg, var(--text-icon) 180deg 300deg, transparent 300deg 360deg)',
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
  const { canEdit, isLoading: permissionsLoading } = useUserPermissionsContext()

  // An id rather than the filtered array: `data` defaults to a fresh `[]` while
  // the query has no data, so an array dependency would re-fire this on every
  // render — exactly during the load this page exists to cover.
  const firstWorkflowId = workflows.find((w) => w.workspaceId === workspaceId)?.id
  const isResolving = isLoading || isPlaceholderData

  useEffect(() => {
    if (isResolving) return

    if (isError) {
      logger.error('Failed to load workflows for workspace')
      return
    }

    if (firstWorkflowId) {
      router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
    }
  }, [isResolving, isError, firstWorkflowId, workspaceId, router])

  /**
   * A workspace can legitimately reach zero workflows — deleting the last one,
   * archiving them all, or creating a workspace with `skipDefaultWorkflow`. This
   * is the terminal state for those paths now that the chat composer is no
   * longer a landing option, so it has to offer a way out rather than spin.
   */
  const isEmpty = !isResolving && !isError && !firstWorkflowId
  const canCreate = !permissionsLoading && canEdit

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='relative h-full w-full flex-1 bg-[var(--bg)]'>
        <div className='workflow-container flex h-full items-center justify-center bg-[var(--bg)]'>
          {isError ? (
            // This is the landing route now, so a failed list fetch would
            // otherwise spin forever with nothing but a log line.
            <div className='flex flex-col items-center gap-3 text-center text-[var(--text-secondary)]'>
              <div>
                <p className='text-small'>Couldn't load workflows</p>
                <p className='mt-1 text-caption'>Check your connection and try again.</p>
              </div>
              <Chip variant='primary' onClick={() => router.refresh()}>
                Retry
              </Chip>
            </div>
          ) : isEmpty ? (
            <div className='flex flex-col items-center gap-3 text-center text-[var(--text-secondary)]'>
              <div>
                <p className='text-small'>No workflows yet</p>
                <p className='mt-1 text-caption'>
                  {canCreate
                    ? 'Create one to start building.'
                    : 'Ask a workspace admin to create one.'}
                </p>
              </div>
              {/* The create mutation navigates optimistically, so offering it
                  without write access would strand a read-only member on a
                  workflow the server declined to create. */}
              {canCreate && (
                <Chip
                  variant='primary'
                  onClick={handleCreateWorkflow}
                  disabled={isCreatingWorkflow}
                >
                  {isCreatingWorkflow ? 'Creating…' : 'Create workflow'}
                </Chip>
              )}
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
