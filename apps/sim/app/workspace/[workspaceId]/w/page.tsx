'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows, isLoading, loadWorkflows } = useWorkflowRegistry()
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
        console.error('Failed to load workflows for workspace:', error)
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
      router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0]}`)
    }
  }, [hasInitialized, isLoading, workflows, workspaceId, router])

  // Always show loading state until redirect happens
  // There should always be a default workflow, so we never show "no workflows found"
  return (
    <div className='flex h-screen items-center justify-center'>
      <div className='text-center'>
        <div className='mx-auto mb-4'>
          <LoadingAgent size='lg' />
        </div>
      </div>
    </div>
  )
}
