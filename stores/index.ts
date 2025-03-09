import { useEffect } from 'react'
import { useChatStore } from './chat/store'
import { useConsoleStore } from './console/store'
import { useCustomToolsStore } from './custom-tools/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useEnvironmentStore } from './settings/environment/store'
import { useWorkflowRegistry } from './workflows/registry/store'
import { useSubBlockStore } from './workflows/subblock/store'
import { useWorkflowStore } from './workflows/workflow/store'

// Helper function to reset all stores
export const resetAllStores = () => {
  // Reset all stores to initial state
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowId: null,
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  useNotificationStore.setState({ notifications: [] })
  useEnvironmentStore.setState({ variables: {}, isLoading: false, error: null })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [], isOpen: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
  useCustomToolsStore.setState({ tools: {} })
}
