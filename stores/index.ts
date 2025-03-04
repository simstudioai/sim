import { useEffect } from 'react'
import { useChatStore } from './chat/store'
import { useConsoleStore } from './console/store'
import { useCustomToolsStore } from './custom-tools/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useEnvironmentStore } from './settings/environment/store'
import { getSyncManagers, initializeSyncManagers } from './sync-registry'
import {
  loadRegistry,
  loadSubblockValues,
  loadWorkflowState,
  saveSubblockValues,
  saveWorkflowState,
} from './workflows/persistence'
import { useWorkflowRegistry } from './workflows/registry/store'
import { useSubBlockStore } from './workflows/subblock/store'
import { useWorkflowStore } from './workflows/workflow/store'

// Track initialization state
let isInitializing = false

/**
 * Initialize the application state and sync system
 */
async function initializeApplication(): Promise<void> {
  if (typeof window === 'undefined' || isInitializing) return

  isInitializing = true

  try {
    // Initialize sync system first and fetch data from DB
    await initializeSyncManagers()

    // After DB sync, check if we need to load from localStorage
    // This is a fallback in case DB sync failed or there's no data in DB
    const registryState = useWorkflowRegistry.getState()
    if (Object.keys(registryState.workflows).length === 0) {
      // No workflows loaded from DB, try localStorage as fallback
      const workflows = loadRegistry()
      if (workflows && Object.keys(workflows).length > 0) {
        console.log('Loading workflows from localStorage as fallback')
        useWorkflowRegistry.setState({ workflows })

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          initializeWorkflowState(activeWorkflowId)
        }
      }
    } else {
      console.log('Using workflows loaded from DB, ignoring localStorage')
    }

    // 2. Register cleanup
    window.addEventListener('beforeunload', handleBeforeUnload)
  } catch (error) {
    console.error('Error during application initialization:', error)
  } finally {
    isInitializing = false
  }
}

function initializeWorkflowState(workflowId: string): void {
  // Load the specific workflow state from localStorage
  const workflowState = loadWorkflowState(workflowId)
  if (!workflowState) {
    console.warn(`No saved state found for workflow ${workflowId}`)
    return
  }

  // Set the workflow store state with the loaded state
  useWorkflowStore.setState(workflowState)

  // Initialize subblock values for this workflow
  const subblockValues = loadSubblockValues(workflowId)
  if (subblockValues) {
    // Update the subblock store with the loaded values
    useSubBlockStore.setState((state) => ({
      workflowValues: {
        ...state.workflowValues,
        [workflowId]: subblockValues,
      },
    }))
  } else if (workflowState.blocks) {
    // If no saved subblock values, initialize from blocks
    useSubBlockStore.getState().initializeFromWorkflow(workflowId, workflowState.blocks)
  }

  console.log(`Initialized workflow state for ${workflowId}`)
}

/**
 * Handle application cleanup before unload
 */
function handleBeforeUnload(event: BeforeUnloadEvent): void {
  // 1. Persist current state
  const currentId = useWorkflowRegistry.getState().activeWorkflowId
  if (currentId) {
    const currentState = useWorkflowStore.getState()

    // Save the current workflow state with its ID
    saveWorkflowState(currentId, {
      blocks: currentState.blocks,
      edges: currentState.edges,
      loops: currentState.loops,
      isDeployed: currentState.isDeployed,
      deployedAt: currentState.deployedAt,
      lastSaved: Date.now(),
      // Include history for undo/redo functionality
      history: currentState.history,
    })

    // Save subblock values for the current workflow
    const subblockValues = useSubBlockStore.getState().workflowValues[currentId]
    if (subblockValues) {
      saveSubblockValues(currentId, subblockValues)
    }
  }

  // 2. Final sync for managers that need it
  getSyncManagers()
    .filter((manager) => manager.config.syncOnExit)
    .forEach((manager) => {
      manager.sync()
    })

  // 3. Cleanup managers
  getSyncManagers().forEach((manager) => manager.dispose())

  // Standard beforeunload pattern
  event.preventDefault()
  event.returnValue = ''
}

/**
 * Clean up sync system
 */
function cleanupApplication(): void {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  getSyncManagers().forEach((manager) => manager.dispose())
}

/**
 * Hook to manage application lifecycle
 */
export function useAppInitialization() {
  useEffect(() => {
    // Use Promise to handle async initialization
    initializeApplication()

    return () => {
      cleanupApplication()
    }
  }, [])
}

// Initialize immediately when imported on client
if (typeof window !== 'undefined') {
  initializeApplication()
}

// Export all stores
export {
  useWorkflowStore,
  useWorkflowRegistry,
  useNotificationStore,
  useEnvironmentStore,
  useExecutionStore,
  useConsoleStore,
  useChatStore,
  useCustomToolsStore,
}

// Helper function to reset all stores
export const resetAllStores = () => {
  if (typeof window !== 'undefined') {
    // Selectively clear localStorage items
    const keysToKeep = ['next-favicon']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  }

  // Reset all stores to initial state
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowId: null,
    isLoading: false,
    error: null,
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  useNotificationStore.setState({ notifications: [] })
  useEnvironmentStore.setState({ variables: {} })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [], isOpen: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
  useCustomToolsStore.setState({ tools: {} })
}

// Helper function to log all store states
export const logAllStores = () => {
  const state = {
    workflow: useWorkflowStore.getState(),
    workflowRegistry: useWorkflowRegistry.getState(),
    notifications: useNotificationStore.getState(),
    environment: useEnvironmentStore.getState(),
    execution: useExecutionStore.getState(),
    console: useConsoleStore.getState(),
    chat: useChatStore.getState(),
    customTools: useCustomToolsStore.getState(),
    subBlock: useSubBlockStore.getState(),
  }

  console.group('Application State')
  Object.entries(state).forEach(([storeName, storeState]) => {
    console.group(storeName)
    console.log(storeState)
    console.groupEnd()
  })
  console.groupEnd()

  return state
}

// Re-export sync managers
export { workflowSync, environmentSync } from './sync-registry'
