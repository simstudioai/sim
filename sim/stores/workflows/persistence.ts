/**
 * Centralized persistence layer for workflow stores
 * Handles localStorage interactions and synchronization
 */
import { createLogger } from '@/lib/logs/console-logger'
import { STORAGE_KEYS } from '../constants'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'

const logger = createLogger('Workflows Persistence')

/**
 * Save data to localStorage with error handling
 */
export function saveToStorage<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    return true
  } catch (error) {
    logger.error(`Failed to save data to ${key}:`, { error })
    return false
  }
}

/**
 * Load data from localStorage with error handling
 */
export function loadFromStorage<T>(key: string): T | null {
  try {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch (error) {
    logger.error(`Failed to load data from ${key}:`, { error })
    return null
  }
}

/**
 * Remove data from localStorage with error handling
 */
export function removeFromStorage(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch (error) {
    logger.error(`Failed to remove data from ${key}:`, { error })
    return false
  }
}

/**
 * Save workflow state to localStorage
 */
export function saveWorkflowState(workflowId: string, state: any): boolean {
  // We need to handle history separately since it's not part of the base WorkflowState
  return saveToStorage(STORAGE_KEYS.WORKFLOW(workflowId), state)
}

/**
 * Load workflow state from localStorage
 */
export function loadWorkflowState(workflowId: string): any {
  return loadFromStorage(STORAGE_KEYS.WORKFLOW(workflowId))
}

/**
 * Save subblock values to localStorage
 */
export function saveSubblockValues(workflowId: string, values: any): boolean {
  return saveToStorage(STORAGE_KEYS.SUBBLOCK(workflowId), values)
}

/**
 * Load subblock values from localStorage
 */
export function loadSubblockValues(workflowId: string): any {
  return loadFromStorage(STORAGE_KEYS.SUBBLOCK(workflowId))
}

/**
 * Save registry to localStorage
 */
export function saveRegistry(registry: any): boolean {
  return saveToStorage(STORAGE_KEYS.REGISTRY, registry)
}

/**
 * Load registry from localStorage
 */
export function loadRegistry(): any {
  return loadFromStorage(STORAGE_KEYS.REGISTRY)
}

/**
 * Initialize all stores from localStorage
 * This is the main initialization function that should be called once at app startup
 */
export function initializeStores(): void {
  if (typeof window === 'undefined') return

  // Initialize registry first
  const workflows = loadRegistry()
  if (workflows) {
    useWorkflowRegistry.setState({ workflows })

    // If there's an active workflow ID in the registry, load it
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId) {
      // Load workflow state
      const workflowState = loadWorkflowState(activeWorkflowId)
      if (workflowState) {
        // Initialize workflow store with saved state
        useWorkflowStore.setState(workflowState)

        // Initialize subblock store with workflow values
        const subblockValues = loadSubblockValues(activeWorkflowId)
        if (subblockValues) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: subblockValues,
            },
          }))
        } else if (workflowState.blocks) {
          // If no saved subblock values, initialize from blocks
          useSubBlockStore.getState().initializeFromWorkflow(activeWorkflowId, workflowState.blocks)
        }
      }
    }
  }

  // Setup unload persistence
  setupUnloadPersistence()
}

/**
 * Setup persistence for page unload events
 */
export function setupUnloadPersistence(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeunload', (event) => {
    // Check if we're on an authentication page and skip confirmation if we are
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

    const currentId = useWorkflowRegistry.getState().activeWorkflowId
    if (currentId) {
      // Save workflow state
      const currentState = useWorkflowStore.getState()

      // Save the complete state including history which is added by middleware
      saveWorkflowState(currentId, {
        blocks: currentState.blocks,
        edges: currentState.edges,
        loops: currentState.loops,
        isDeployed: currentState.isDeployed,
        deployedAt: currentState.deployedAt,
        lastSaved: Date.now(),
        history: currentState.history,
      })

      // Save subblock values
      const subblockValues = useSubBlockStore.getState().workflowValues[currentId]
      if (subblockValues) {
        saveSubblockValues(currentId, subblockValues)
      }
    }

    // Save registry
    saveRegistry(useWorkflowRegistry.getState().workflows)

    // Only prevent navigation on non-auth pages
    event.preventDefault()
    event.returnValue = ''
  })
}
