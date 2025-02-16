import { useChatStore } from './chat/store'
import { useConsoleStore } from './console/store'
import { useEnvironmentStore } from './environment/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useWorkflowRegistry } from './workflow/registry/store'
import { useWorkflowStore } from './workflow/store'

/**
 * Reset all application stores to their initial state
 */
export const resetAllStores = () => {
  // Clear localStorage first
  if (typeof window !== 'undefined') {
    localStorage.clear()
  }

  // Force immediate state reset for all stores
  // This ensures in-memory state is also cleared
  useWorkflowStore.getState().clear()
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowId: null,
    isLoading: false,
    error: null,
  })
  useNotificationStore.setState({ notifications: [] })
  useEnvironmentStore.setState({ variables: {} })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [], isOpen: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
}

/**
 * Log the current state of all stores
 */
export const logAllStores = () => {
  const state = {
    workflow: useWorkflowStore.getState(),
    workflowRegistry: useWorkflowRegistry.getState(),
    notifications: useNotificationStore.getState(),
    environment: useEnvironmentStore.getState(),
    execution: useExecutionStore.getState(),
    console: useConsoleStore.getState(),
    chat: useChatStore.getState(),
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

// Export all stores for convenience
export {
  useWorkflowStore,
  useWorkflowRegistry,
  useNotificationStore,
  useEnvironmentStore,
  useExecutionStore,
  useConsoleStore,
  useChatStore,
}
