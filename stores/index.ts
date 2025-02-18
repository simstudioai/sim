import { useChatStore } from './chat/store'
import { useConsoleStore } from './console/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useEnvironmentStore } from './settings/environment/store'
import { useGeneralStore } from './settings/general/store'
import { initializeSyncManager } from './sync-manager'
import { useWorkflowRegistry } from './workflow/registry/store'
import { useWorkflowStore } from './workflow/store'

// Initialize sync manager when the store is first imported
// if (typeof window !== 'undefined') {
//   initializeSyncManager()
// }

// Reset all application stores to their initial state
export const resetAllStores = () => {
  // Selectively clear localStorage items
  if (typeof window !== 'undefined') {
    const keysToKeep = ['next-favicon']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
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
  useGeneralStore.setState({ isAutoConnectEnabled: true, isDebugModeEnabled: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
}

// Log the current state of all stores
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
