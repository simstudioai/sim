'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('WorkspacePage')

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending } = useSession()

  useEffect(() => {
    const redirectToFirstWorkspace = async () => {
      // Wait for session to load
      if (isPending) {
        return
      }

      // If user is not authenticated, redirect to login
      if (!session?.user) {
        logger.info('User not authenticated, redirecting to login')
        router.replace('/login')
        return
      }

      try {
        // Check if we need to redirect a specific workflow from old URL format
        const urlParams = new URLSearchParams(window.location.search)
        const redirectWorkflowId = urlParams.get('redirect_workflow')

        if (redirectWorkflowId) {
          // Try to get the workspace for this workflow
          try {
            const workflowResponse = await fetch(`/api/workflows/${redirectWorkflowId}`)
            if (workflowResponse.ok) {
              const workflowData = await workflowResponse.json()
              const workspaceId = workflowData.data?.workspaceId

              if (workspaceId) {
                logger.info(
                  `Redirecting workflow ${redirectWorkflowId} to workspace ${workspaceId}`
                )
                router.replace(`/workspace/${workspaceId}/w/${redirectWorkflowId}`)
                return
              }
            }
          } catch (error) {
            logger.error('Error fetching workflow for redirect:', error)
          }
        }

        // Fetch user's workspaces
        const response = await fetch('/api/workspaces')

        if (!response.ok) {
          throw new Error('Failed to fetch workspaces')
        }

        const data = await response.json()
        const workspaces = data.workspaces || []

        if (workspaces.length === 0) {
          logger.warn('No workspaces found for user, creating default workspace')

          try {
            const createResponse = await fetch('/api/workspaces', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: 'My Workspace' }),
            })

            if (createResponse.ok) {
              const createData = await createResponse.json()
              const newWorkspace = createData.workspace

              if (newWorkspace?.id) {
                logger.info(`Created default workspace: ${newWorkspace.id}`)
                router.replace(`/workspace/${newWorkspace.id}/w`)
                return
              }
            }

            logger.error('Failed to create default workspace')
          } catch (createError) {
            logger.error('Error creating default workspace:', createError)
          }

          // If we can't create a workspace, redirect to login to reset state
          router.replace('/login')
          return
        }

        // Get the first workspace (they should be ordered by most recent)
        const firstWorkspace = workspaces[0]
        logger.info(`Redirecting to first workspace: ${firstWorkspace.id}`)

        // Redirect to the first workspace
        router.replace(`/workspace/${firstWorkspace.id}/w`)
      } catch (error) {
        logger.error('Error fetching workspaces for redirect:', error)
        // Don't redirect if there's an error - let the user stay on the page
      }
    }

    // Only run this logic when we're at the root /workspace path
    // If we're already in a specific workspace, the children components will handle it
    if (typeof window !== 'undefined' && window.location.pathname === '/workspace') {
      redirectToFirstWorkspace()
    }
  }, [session, isPending, router])

  // Show loading state while we determine where to redirect
  if (isPending) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div className='flex flex-col items-center justify-center text-center align-middle'>
          <LoadingAgent size='lg' />
        </div>
      </div>
    )
  }

  // If user is not authenticated, show nothing (redirect will happen)
  if (!session?.user) {
    return null
  }

  return null
}
