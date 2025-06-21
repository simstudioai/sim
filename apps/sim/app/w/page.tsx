'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows, isLoading } = useWorkflowRegistry()

  useEffect(() => {
    // Wait for workflows to load
    if (isLoading) return

    const workflowIds = Object.keys(workflows)

    // If we have workflows, redirect to the first one
    if (workflowIds.length > 0) {
      router.replace(`/w/${workflowIds[0]}`)
      return
    }

    // If no workflows exist, this means the workspace creation didn't work properly
    // or the user doesn't have any workspaces. Redirect to home to let the system
    // handle workspace/workflow creation properly.
    router.replace('/')
  }, [workflows, isLoading, router])

  // Show loading state while determining where to redirect
  return (
    <div className='flex h-screen items-center justify-center'>
      <div className='text-center'>
        <div className='mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-blue-600 border-b-2' />
        <p className='text-gray-600'>Loading workflows...</p>
      </div>
    </div>
  )
}
