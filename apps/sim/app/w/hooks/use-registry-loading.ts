'use client'

import { useEffect } from 'react'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Custom hook to manage workflow registry loading state
 *
 * This hook initializes the loading state and automatically clears it
 * when workflows are loaded or after a timeout
 */
export function useRegistryLoading() {
  const { workflows, setLoading } = useWorkflowRegistry()

  useEffect(() => {
    // Set loading state initially
    setLoading(true)

    // If workflows are already loaded, clear loading state
    if (Object.keys(workflows).length > 0) {
      setTimeout(() => setLoading(false), 300)
      return
    }

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
  }, [setLoading, workflows])
}
