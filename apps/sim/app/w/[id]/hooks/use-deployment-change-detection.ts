import { useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useDeploymentChangeDetection')

/**
 * Hook to detect when a deployed workflow needs redeployment due to changes
 * Handles debouncing, API checks, and state synchronization
 */
export function useDeploymentChangeDetection(activeWorkflowId: string | null, isDeployed: boolean) {
  const [needsRedeployment, setNeedsRedeployment] = useState(false)

  // Listen for workflow changes and check if redeployment is needed
  useEffect(() => {
    if (!activeWorkflowId || !isDeployed) return

    // Create a debounced function to check for changes
    let debounceTimer: NodeJS.Timeout | null = null
    let lastCheckTime = 0
    let pendingChanges = 0
    const DEBOUNCE_DELAY = 1000
    const THROTTLE_INTERVAL = 3000

    // Store the current workflow ID when the effect runs
    const effectWorkflowId = activeWorkflowId

    // Function to check if redeployment is needed
    const checkForChanges = async () => {
      // No longer skip if we're already showing needsRedeployment
      // This allows us to detect when changes have been reverted

      // Reset the pending changes counter
      pendingChanges = 0
      lastCheckTime = Date.now()

      // Store the current workflow ID to check for race conditions
      const requestedWorkflowId = activeWorkflowId
      logger.debug(`Checking for changes in workflow ${requestedWorkflowId}`)

      try {
        // Get the deployed state from the API
        const response = await fetch(`/api/workflows/${requestedWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()

          // Verify the active workflow hasn't changed while fetching
          if (requestedWorkflowId !== activeWorkflowId) {
            return
          }

          // Always update the needsRedeployment flag based on API response to handle both true and false
          // This ensures it's updated when changes are detected and when changes are no longer detected
          if (data.needsRedeployment) {
            // Update local state
            setNeedsRedeployment(true)

            // Use the workflow-specific method to update the registry
            useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(requestedWorkflowId, true)
          } else {
            // Only update to false if the current state is true to avoid unnecessary updates
            const currentStatus = useWorkflowRegistry
              .getState()
              .getWorkflowDeploymentStatus(requestedWorkflowId)
            if (currentStatus?.needsRedeployment) {
              // Update local state
              setNeedsRedeployment(false)

              // Use the workflow-specific method to update the registry
              useWorkflowRegistry
                .getState()
                .setWorkflowNeedsRedeployment(requestedWorkflowId, false)
            }
          }
        }
      } catch (error) {
        logger.error('Failed to check workflow change status:', { error })
      }
    }

    // Debounced check function
    const debouncedCheck = () => {
      // Skip if the active workflow has changed
      if (effectWorkflowId !== activeWorkflowId) {
        return
      }

      // Increment the pending changes counter
      pendingChanges++

      // Clear any existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      // If we recently checked, and it's within throttle interval, wait longer
      const timeElapsed = Date.now() - lastCheckTime
      if (timeElapsed < THROTTLE_INTERVAL && lastCheckTime > 0) {
        // Wait until the throttle interval has passed
        const adjustedDelay = Math.max(THROTTLE_INTERVAL - timeElapsed, DEBOUNCE_DELAY)

        debounceTimer = setTimeout(() => {
          // Only check if we have pending changes and workflow ID hasn't changed
          if (pendingChanges > 0 && effectWorkflowId === activeWorkflowId) {
            checkForChanges()
          }
        }, adjustedDelay)
      } else {
        // Standard debounce delay if we haven't checked recently
        debounceTimer = setTimeout(() => {
          // Only check if we have pending changes and workflow ID hasn't changed
          if (pendingChanges > 0 && effectWorkflowId === activeWorkflowId) {
            checkForChanges()
          }
        }, DEBOUNCE_DELAY)
      }
    }

    // Subscribe to workflow store changes
    const workflowUnsubscribe = useWorkflowStore.subscribe(debouncedCheck)

    // Subscribe to subBlock store changes to detect subBlock value changes
    const subBlockUnsubscribe = useSubBlockStore.subscribe(debouncedCheck)

    // Cleanup function
    return () => {
      workflowUnsubscribe()
      subBlockUnsubscribe()
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
    }
  }, [activeWorkflowId, isDeployed])

  // Initial check on mount or when active workflow changes
  useEffect(() => {
    async function checkDeploymentStatus() {
      if (!activeWorkflowId) return

      try {
        // Store the current workflow ID to check for race conditions
        const requestedWorkflowId = activeWorkflowId

        const response = await fetch(`/api/workflows/${requestedWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()

          // Verify the active workflow hasn't changed while fetching
          if (requestedWorkflowId !== activeWorkflowId) {
            return
          }

          // Update the store with the status from the API
          useWorkflowRegistry
            .getState()
            .setDeploymentStatus(
              requestedWorkflowId,
              data.isDeployed,
              data.deployedAt ? new Date(data.deployedAt) : undefined
            )

          // Update local state
          setNeedsRedeployment(data.needsRedeployment)

          // Use the workflow-specific method to update the registry
          useWorkflowRegistry
            .getState()
            .setWorkflowNeedsRedeployment(requestedWorkflowId, data.needsRedeployment)
        }
      } catch (error) {
        logger.error('Failed to check workflow status:', { error })
      }
    }
    checkDeploymentStatus()
  }, [activeWorkflowId])

  // Listen for deployment status changes
  useEffect(() => {
    // When deployment status changes and isDeployed becomes true,
    // that means a deployment just occurred, so reset the needsRedeployment flag
    if (isDeployed) {
      // Update local state
      setNeedsRedeployment(false)

      // Use the workflow-specific method to update the registry
      if (activeWorkflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(activeWorkflowId, false)
      }
    }
  }, [isDeployed, activeWorkflowId])

  // Add a listener for the needsRedeployment flag in the workflow store
  useEffect(() => {
    const unsubscribe = useWorkflowStore.subscribe((state) => {
      // Only update local state when it's for the currently active workflow
      if (state.needsRedeployment !== undefined) {
        // Get the workflow-specific needsRedeployment flag for the current workflow
        const currentWorkflowStatus = useWorkflowRegistry
          .getState()
          .getWorkflowDeploymentStatus(activeWorkflowId)

        // Only set local state based on current workflow's status
        if (currentWorkflowStatus?.needsRedeployment !== undefined) {
          setNeedsRedeployment(currentWorkflowStatus.needsRedeployment)
        } else {
          // Fallback to global state only if we don't have workflow-specific status
          setNeedsRedeployment(state.needsRedeployment)
        }
      }
    })

    return () => unsubscribe()
  }, [activeWorkflowId])

  // Function to clear the redeployment flag
  const clearNeedsRedeployment = () => {
    // Update local state
    setNeedsRedeployment(false)

    // Use the workflow-specific method to update the registry
    if (activeWorkflowId) {
      useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(activeWorkflowId, false)
    }
  }

  return {
    needsRedeployment,
    setNeedsRedeployment,
    clearNeedsRedeployment,
  }
}
