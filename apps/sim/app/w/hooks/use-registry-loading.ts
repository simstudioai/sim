'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
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
 * when workflows are loaded. It also handles smart workspace selection
 * and navigation for first-time users.
 */
export function useRegistryLoading() {
  const { workflows, setLoading, isLoading, activeWorkspaceId, loadWorkspaceFromWorkflowId } =
    useWorkflowRegistry()
  const pathname = usePathname()
  const router = useRouter()

  // Handle workspace selection from URL
  useEffect(() => {
    if (!activeWorkspaceId) {
      const workflowIdFromUrl = extractWorkflowIdFromPathname(pathname)
      if (workflowIdFromUrl) {
        loadWorkspaceFromWorkflowId(workflowIdFromUrl).catch((error) => {
          logger.warn('Failed to load workspace from workflow ID:', error)
        })
      }
    }
  }, [activeWorkspaceId, pathname, loadWorkspaceFromWorkflowId])

  // Handle first-time navigation: if we're at /w and have workflows, navigate to first one
  useEffect(() => {
    if (!isLoading && activeWorkspaceId && Object.keys(workflows).length > 0) {
      const workflowCount = Object.keys(workflows).length
      const currentWorkflowId = extractWorkflowIdFromPathname(pathname)

      // If we're at a generic workspace URL (/w, /w/, or /w/workspaceId) without a specific workflow
      if (
        !currentWorkflowId &&
        (pathname === '/w' || pathname === '/w/' || pathname === `/w/${activeWorkspaceId}`)
      ) {
        const firstWorkflowId = Object.keys(workflows)[0]
        logger.info('First-time navigation: redirecting to first workflow:', firstWorkflowId)
        router.replace(`/w/${firstWorkflowId}`)
      }
    }
  }, [isLoading, activeWorkspaceId, workflows, pathname, router])

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
