'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows, isLoading, loadWorkflows } = useWorkflowRegistry()

  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Load workflows for this specific workspace when component mounts or workspaceId changes
  // Only load if we don't already have workflows for this workspace (to prevent duplicate calls during workspace switches)
  useEffect(() => {
    if (workspaceId) {
      // Check if we already have workflows for this workspace
      const workflowIds = Object.keys(workflows)
      const hasWorkflowsForWorkspace =
        workflowIds.length > 0 &&
        Object.values(workflows).some((w) => w.workspaceId === workspaceId)

      // Only load if we don't have workflows for this workspace and we're not loading
      if (!hasWorkflowsForWorkspace && !isLoading) {
        loadWorkflows(workspaceId)
      }
    }
  }, [workspaceId, loadWorkflows, isLoading, workflows])

  useEffect(() => {
    // Wait for workflows to load
    if (isLoading) return

    const workflowIds = Object.keys(workflows)

    // If we have workflows, redirect to the first one (database already sorted by lastModified desc)
    if (workflowIds.length > 0) {
      router.replace(`/workspace/${workspaceId}/w/${workflowIds[0]}`)
      return
    }

    // If no workflows exist after loading is complete, this means the workspace creation
    // didn't work properly or the user doesn't have any workspaces.
    // Redirect to home to let the system handle workspace/workflow creation properly.
    router.replace('/')
  }, [workflows, isLoading, router, workspaceId])

  // Show loading state while determining where to redirect
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
