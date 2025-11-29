'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowsPage')

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows, setActiveWorkflow } = useWorkflowRegistry()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Fetch workflows using React Query
  const { isLoading, isError } = useWorkflows(workspaceId)

  // Handle redirection once workflows are loaded
  useEffect(() => {
    // Only proceed if workflows are done loading
    if (isLoading) return

    if (isError) {
      logger.error('Failed to load workflows for workspace')
      return
    }

    const workflowIds = Object.keys(workflows)

    // Validate that workflows belong to the current workspace
    const workspaceWorkflows = workflowIds.filter((id) => {
      const workflow = workflows[id]
      return workflow.workspaceId === workspaceId
    })

    // If we have valid workspace workflows, redirect to the first one
    if (workspaceWorkflows.length > 0) {
      const firstWorkflowId = workspaceWorkflows[0]
      router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
    }
  }, [isLoading, workflows, workspaceId, router, setActiveWorkflow, isError])

  // Always show loading state until redirect happens
  // There should always be a default workflow, so we never show "no workflows found"
  return (
    <div className='flex h-screen items-center justify-center'>
      <div className='text-center'>
        <div className='mx-auto mb-4'>
          <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
        </div>
      </div>
    </div>
  )
}
