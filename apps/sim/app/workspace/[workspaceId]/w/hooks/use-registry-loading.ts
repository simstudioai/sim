'use client'

import { useEffect } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('UseRegistryLoading')

/**
 * Extract workflow ID from pathname
 * @param pathname - Current pathname
 * @returns workflow ID if found, null otherwise
 */
function extractWorkflowIdFromPathname(pathname: string): string | null {
  try {
    const pathSegments = pathname.split('/')
    // Check if URL matches pattern /w/{workflowId}
    if (pathSegments.length >= 3 && pathSegments[1] === 'w') {
      const workflowId = pathSegments[2]
      // Basic UUID validation (36 characters, contains hyphens)
      if (workflowId && workflowId.length === 36 && workflowId.includes('-')) {
        return workflowId
      }
    }
    return null
  } catch (error) {
    logger.warn('Failed to extract workflow ID from pathname:', error)
    return null
  }
}

/**
 * Custom hook to manage workflow registry loading state and handle first-time navigation
 *
 * This hook initializes the loading state and automatically clears it
 * when workflows are loaded. It also handles navigation for first-time users.
 */
export function useRegistryLoading() {
  const { workflows, setLoading, isLoading, loadWorkflows } = useWorkflowRegistry()
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Load workflows for current workspace
  useEffect(() => {
    if (workspaceId) {
      loadWorkflows(workspaceId).catch((error) => {
        logger.warn('Failed to load workflows for workspace:', error)
      })
    }
  }, [workspaceId, loadWorkflows])

  // Handle first-time navigation: if we're at /w and have workflows, navigate to first one
  useEffect(() => {
    if (!isLoading && workspaceId && Object.keys(workflows).length > 0) {
      const currentWorkflowId = extractWorkflowIdFromPathname(pathname)

      // Check if we're on the workspace root and need to redirect to first workflow
      if (
        (pathname === `/workspace/${workspaceId}/w` ||
          pathname === `/workspace/${workspaceId}/w/`) &&
        Object.keys(workflows).length > 0
      ) {
        const firstWorkflowId = Object.keys(workflows)[0]
        logger.info('First-time navigation: redirecting to first workflow:', firstWorkflowId)
        router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
      }
    }
  }, [isLoading, workspaceId, workflows, pathname, router])

  // Handle loading states
  useEffect(() => {
    // Only set loading if we don't have workflows and aren't already loading
    if (Object.keys(workflows).length === 0 && !isLoading) {
      setLoading(true)
    }

    // If workflows are already loaded, clear loading state
    if (Object.keys(workflows).length > 0 && isLoading) {
      setTimeout(() => setLoading(false), 100)
      return
    }

    // Only create timeout if we're actually loading
    if (!isLoading) return

    // Create a timeout to clear loading state after max time
    const timeout = setTimeout(() => {
      setLoading(false)
    }, 3000) // 3 second maximum loading time

    // Listen for workflows to be loaded
    const checkInterval = setInterval(() => {
      const currentWorkflows = useWorkflowRegistry.getState().workflows
      if (Object.keys(currentWorkflows).length > 0) {
        setLoading(false)
        clearInterval(checkInterval)
      }
    }, 200)

    return () => {
      clearTimeout(timeout)
      clearInterval(checkInterval)
    }
  }, [setLoading, workflows, isLoading])
}
