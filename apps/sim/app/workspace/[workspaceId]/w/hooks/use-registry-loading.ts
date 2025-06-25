'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('UseRegistryLoading')

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

  // Track hydration state to prevent premature API calls
  const [isHydrated, setIsHydrated] = useState(false)

  // Handle client-side hydration
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Load workflows for current workspace only after hydration
  useEffect(() => {
    // Only proceed if we're hydrated and have a valid workspaceId
    if (
      !isHydrated ||
      !workspaceId ||
      typeof workspaceId !== 'string' ||
      workspaceId.trim() === ''
    ) {
      return
    }

    logger.debug('Loading workflows for workspace:', workspaceId)
    loadWorkflows(workspaceId).catch((error) => {
      logger.warn('Failed to load workflows for workspace:', error)
    })
  }, [isHydrated, workspaceId, loadWorkflows])

  // Handle first-time navigation: if we're at /w and have workflows, navigate to first one
  useEffect(() => {
    // Only proceed if hydrated and we have valid data
    if (!isHydrated || !workspaceId || isLoading || Object.keys(workflows).length === 0) {
      return
    }

    // Check if we're on the workspace root and need to redirect to first workflow
    if (
      (pathname === `/workspace/${workspaceId}/w` || pathname === `/workspace/${workspaceId}/w/`) &&
      Object.keys(workflows).length > 0
    ) {
      const firstWorkflowId = Object.keys(workflows)[0]
      logger.info('First-time navigation: redirecting to first workflow:', firstWorkflowId)
      router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
    }
  }, [isHydrated, isLoading, workspaceId, workflows, pathname, router])

  // Handle loading states - only after hydration
  useEffect(() => {
    // Don't manage loading state until we're hydrated
    if (!isHydrated) return

    // Only set loading if we don't have workflows and aren't already loading
    if (Object.keys(workflows).length === 0 && !isLoading) {
      setLoading(true)
    }

    // If workflows are already loaded, clear loading state
    if (Object.keys(workflows).length > 0 && isLoading) {
      setTimeout(() => setLoading(false), 100)
      return
    }

    // The fetch function itself handles setting isLoading to false
  }, [isHydrated, setLoading, workflows, isLoading])
}
