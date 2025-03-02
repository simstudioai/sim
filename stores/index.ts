import { useChatStore } from './chat/store'
import { useConsoleStore } from './console/store'
import { useCustomToolsStore } from './custom-tools/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useEnvironmentStore } from './settings/environment/store'
import { useGeneralStore } from './settings/general/store'
import { initializeSyncSystem } from './sync'
import { useWorkflowRegistry } from './workflows/registry/store'
import { useSubBlockStore } from './workflows/subblock/store'
import { useWorkflowStore } from './workflows/workflow/store'

// Initialize sync system immediately when imported on client
if (typeof window !== 'undefined') {
  initializeSyncSystem()
}

// Reset all application stores to their initial state
export const resetAllStores = () => {
  // Track all workflow IDs for deletion before clearing
  if (typeof window !== 'undefined') {
    // Selectively clear localStorage items
    const keysToKeep = ['next-favicon']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  }

  // Force immediate state reset for all stores
  // This ensures in-memory state is also cleared
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
  useGeneralStore.setState({ isAutoConnectEnabled: true, isDebugModeEnabled: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
  useCustomToolsStore.setState({ tools: {} })
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

// Export all stores for convenience
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
