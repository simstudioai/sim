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

  // Always load workflows for the current workspace to ensure we have the correct ones
  useEffect(() => {
    if (!isLoading) {
      loadWorkflows(workspaceId)
    }
  }, [workspaceId, loadWorkflows, isLoading])

  useEffect(() => {
    // Wait for workflows to load
    if (isLoading) return

    // Filter workflows for this workspace only
    const workspaceWorkflows = Object.values(workflows).filter(
      (workflow) => workflow.workspaceId === workspaceId
    )

    // If we have workflows for this workspace, redirect to the first one
    if (workspaceWorkflows.length > 0) {
      // Sort by last modified date (newest first) - same logic as sidebar
      const sortedWorkflows = workspaceWorkflows.sort((a, b) => {
        const dateA =
          a.lastModified instanceof Date
            ? a.lastModified.getTime()
            : new Date(a.lastModified).getTime()
        const dateB =
          b.lastModified instanceof Date
            ? b.lastModified.getTime()
            : new Date(b.lastModified).getTime()
        return dateB - dateA
      })

      const firstWorkflowId = sortedWorkflows[0].id
      router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
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
