'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowsPage')

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows, isLoading, loadWorkflows, setActiveWorkflow } = useWorkflowRegistry()
  const [hasInitialized, setHasInitialized] = useState(false)

  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Initialize workspace workflows
  useEffect(() => {
    const initializeWorkspace = async () => {
      try {
        await loadWorkflows(workspaceId)
        setHasInitialized(true)
      } catch (error) {
        logger.error('Failed to load workflows for workspace:', error)
        setHasInitialized(true) // Still mark as initialized to show error state
      }
    }

    if (!hasInitialized) {
      initializeWorkspace()
    }
  }, [workspaceId, loadWorkflows, hasInitialized])

  // Handle redirection once workflows are loaded
  useEffect(() => {
    // Only proceed if we've initialized and workflows are not loading
    if (!hasInitialized || isLoading) return

    const workflowIds = Object.keys(workflows)

    // Validate that workflows belong to the current workspace
    const workspaceWorkflows = workflowIds.filter((id) => {
      const workflow = workflows[id]
      return workflow.workspaceId === workspaceId
    })

    // If we have valid workspace workflows, redirect to the first one
    if (workspaceWorkflows.length > 0) {
      // Ensure the workflow is set as active before redirecting
      // This prevents the empty canvas issue on first login
      const firstWorkflowId = workspaceWorkflows[0]
      setActiveWorkflow(firstWorkflowId).then(() => {
        router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
      })
    }
  }, [hasInitialized, isLoading, workflows, workspaceId, router, setActiveWorkflow])

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
