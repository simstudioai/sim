import { useEffect } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { SubBlockType } from '@/blocks/types'
import { useChatStore } from './chat/store'
import { useCustomToolsStore } from './custom-tools/store'
import { useExecutionStore } from './execution/store'
import { useNotificationStore } from './notifications/store'
import { useConsoleStore } from './panel/console/store'
import { useVariablesStore } from './panel/variables/store'
import { useEnvironmentStore } from './settings/environment/store'
import { getSyncManagers, initializeSyncManagers, resetSyncManagers } from './sync-registry'
import {
  loadRegistry,
  loadSubblockValues,
  loadWorkflowState,
  saveSubblockValues,
  saveWorkflowState,
} from './workflows/persistence'
import { useWorkflowRegistry } from './workflows/registry/store'
import { useSubBlockStore } from './workflows/subblock/store'
import { workflowSync } from './workflows/sync'
import { useWorkflowStore } from './workflows/workflow/store'
import { BlockState } from './workflows/workflow/types'

const logger = createLogger('Stores')

// Track initialization state
let isInitializing = false

/**
 * Initialize the application state and sync system
 *
 * Note: Workflow scheduling is handled automatically by the workflowSync manager
 * when workflows are synced to the database. The scheduling logic checks if a
 * workflow has scheduling enabled in its starter block and updates the schedule
 * accordingly.
 */
async function initializeApplication(): Promise<void> {
  if (typeof window === 'undefined' || isInitializing) return

  isInitializing = true

  try {
    // Load environment variables directly from DB
    await useEnvironmentStore.getState().loadEnvironmentVariables()

    // Set a flag in sessionStorage to detect new login sessions
    // This helps identify fresh logins in private browsers
    const isNewLoginSession = !sessionStorage.getItem('app_initialized')
    sessionStorage.setItem('app_initialized', 'true')

    // Initialize sync system for other stores
    await initializeSyncManagers()

    // After DB sync, check if we need to load from localStorage
    // This is a fallback in case DB sync failed or there's no data in DB
    const registryState = useWorkflowRegistry.getState()
    const hasDbWorkflows = Object.keys(registryState.workflows).length > 0

    if (!hasDbWorkflows) {
      // No workflows loaded from DB, try localStorage as fallback
      const workflows = loadRegistry()
      if (workflows && Object.keys(workflows).length > 0) {
        logger.info('Loading workflows from localStorage as fallback')
        useWorkflowRegistry.setState({ workflows })

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId) {
          initializeWorkflowState(activeWorkflowId)
        }
      } else if (isNewLoginSession) {
        // Critical safeguard: For new login sessions with no DB workflows
        // and no localStorage, we disable sync temporarily to prevent data loss
        logger.info('New login session with no workflows - preventing initial sync')
        const syncManagers = getSyncManagers()
        syncManagers.forEach((manager) => manager.stopIntervalSync())

        // Create the first starter workflow with an agent block for new users
        logger.info('Creating first workflow with agent block for new user')
        createFirstWorkflowWithAgentBlock()
      }
    } else {
      logger.info('Using workflows loaded from DB, ignoring localStorage')
    }

    // 2. Register cleanup
    window.addEventListener('beforeunload', handleBeforeUnload)
  } catch (error) {
    logger.error('Error during application initialization:', { error })
  } finally {
    isInitializing = false
  }
}

function initializeWorkflowState(workflowId: string): void {
  // Load the specific workflow state from localStorage
  const workflowState = loadWorkflowState(workflowId)
  if (!workflowState) {
    logger.warn(`No saved state found for workflow ${workflowId}`)
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

  logger.info(`Initialized workflow state for ${workflowId}`)
}

/**
 * Handle application cleanup before unload
 */
function handleBeforeUnload(event: BeforeUnloadEvent): void {
  // Check if we're on an authentication page and skip confirmation if we are
  if (typeof window !== 'undefined') {
    const path = window.location.pathname
    // Skip confirmation for auth-related pages
    if (
      path === '/login' ||
      path === '/signup' ||
      path === '/reset-password' ||
      path === '/verify'
    ) {
      return
    }
  }

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
 * Clear all user data when signing out
 * This ensures data from one account doesn't persist to another
 */
export async function clearUserData(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // 1. Reset all sync managers to prevent any pending syncs
    resetSyncManagers()

    // 2. Reset all stores to their initial state
    resetAllStores()

    // 3. Clear localStorage except for essential app settings
    const keysToKeep = ['next-favicon', 'theme']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))

    logger.info('User data cleared successfully')
  } catch (error) {
    logger.error('Error clearing user data:', { error })
  }
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

/**
 * Hook to reinitialize the application after successful login
 * Use this in the login success handler or post-login page
 */
export function useLoginInitialization() {
  useEffect(() => {
    reinitializeAfterLogin()
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
  useVariablesStore,
}

// Helper function to reset all stores
export const resetAllStores = () => {
  // Reset all stores to initial state
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowId: null,
    isLoading: false,
    error: null,
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  useSubBlockStore.getState().clearToolParams()
  useNotificationStore.setState({ notifications: [] })
  useEnvironmentStore.setState({
    variables: {},
    isLoading: false,
    error: null,
  })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [], isOpen: false })
  useChatStore.setState({ messages: [], isProcessing: false, error: null })
  useCustomToolsStore.setState({ tools: {} })
  useVariablesStore.getState().resetLoaded() // Reset variables store tracking
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
    variables: useVariablesStore.getState(),
  }

  return state
}

/**
 * Reinitialize the application after login
 * This ensures we load fresh data from the database for the new user
 */
export async function reinitializeAfterLogin(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Reset sync managers to prevent any active syncs during reinitialization
    resetSyncManagers()

    // Clean existing state to avoid stale data
    resetAllStores()

    // Mark as a new login session
    sessionStorage.removeItem('app_initialized')

    // Reset initialization flags to force a fresh load
    isInitializing = false

    // Reinitialize the application
    await initializeApplication()

    logger.info('Application reinitialized after login')
  } catch (error) {
    logger.error('Error reinitializing application:', { error })
  }
}

/**
 * Creates the first workflow with a starter and agent block for new users
 */
function createFirstWorkflowWithAgentBlock(): void {
  // Create a workflow with default settings
  const workflowId = useWorkflowRegistry.getState().createWorkflow({
    name: 'My First Workflow',
    description: 'Getting started with agents',
    isInitial: true,
  })

  // Get the current workflow state
  const workflowState = useWorkflowStore.getState()
  const starterBlockId = Object.keys(workflowState.blocks)[0]

  if (!starterBlockId) {
    logger.error('Failed to find starter block in new workflow')
    return
  }

  // Create an agent block
  const agentBlockId = crypto.randomUUID()
  const agentBlock: BlockState = {
    id: agentBlockId,
    type: 'agent',
    name: 'Agent',
    position: { x: 577.2367674819552, y: -173.0961530669049 },
    subBlocks: {
      systemPrompt: {
        id: 'systemPrompt',
        type: 'long-input' as SubBlockType,
        value: 'You are a helpful assistant.',
      },
      context: {
        id: 'context',
        type: 'short-input' as SubBlockType,
        value: '',
      },
      model: {
        id: 'model',
        type: 'dropdown' as SubBlockType,
        value: 'gpt-4o',
      },
      temperature: {
        id: 'temperature',
        type: 'slider' as SubBlockType,
        value: 0.7,
      },
      apiKey: {
        id: 'apiKey',
        type: 'short-input' as SubBlockType,
        value: '',
      },
      tools: {
        id: 'tools',
        type: 'tool-input' as SubBlockType,
        value: '[]',
      },
      responseFormat: {
        id: 'responseFormat',
        type: 'code' as SubBlockType,
        value: null,
      },
    },
    outputs: {
      response: {
        content: 'string',
        model: 'string',
        tokens: 'any',
        toolCalls: 'any',
      },
    },
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    height: 642,
  }

  // Create an edge connecting starter to agent
  const edgeId = crypto.randomUUID()
  const edge = {
    id: edgeId,
    source: starterBlockId,
    target: agentBlockId,
  }

  // Update the workflow state with the new block and edge
  const updatedState = {
    ...workflowState,
    blocks: {
      ...workflowState.blocks,
      [agentBlockId]: agentBlock,
    },
    edges: [...workflowState.edges, edge],
    history: {
      ...workflowState.history,
      present: {
        ...workflowState.history.present,
        state: {
          ...workflowState.history.present.state,
          blocks: {
            ...workflowState.history.present.state.blocks,
            [agentBlockId]: agentBlock,
          },
          edges: [...(workflowState.history.present.state.edges || []), edge],
        },
      },
    },
    lastSaved: Date.now(),
  }

  // Set the updated state
  useWorkflowStore.setState(updatedState)

  // Initialize subblock values for agent block
  useSubBlockStore.getState().initializeFromWorkflow(workflowId, updatedState.blocks)

  // Save the updated workflow state
  saveWorkflowState(workflowId, updatedState)

  // Resume sync managers after initialization
  setTimeout(() => {
    const syncManagers = getSyncManagers()
    syncManagers.forEach((manager) => manager.startIntervalSync())
    workflowSync.sync()
  }, 1000)

  logger.info('First workflow with agent block created successfully')
}

// Re-export sync managers
export { workflowSync } from './workflows/sync'
