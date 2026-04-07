'use client'

import { createLogger } from '@sim/logger'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { environmentKeys } from '@/hooks/queries/environment'
import { useExecutionStore } from '@/stores/execution'
import { consolePersistence, useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Stores')

/**
 * Reset all Zustand stores and React Query caches to initial state.
 */
export const resetAllStores = () => {
  useWorkflowRegistry.setState({
    activeWorkflowId: null,
    error: null,
    hydration: {
      phase: 'idle',
      workspaceId: null,
      workflowId: null,
      requestId: null,
      error: null,
    },
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  getQueryClient().removeQueries({ queryKey: environmentKeys.all })
  useExecutionStore.getState().reset()
  useTerminalConsoleStore.setState({
    workflowEntries: {},
    entryIdsByBlockExecution: {},
    entryLocationById: {},
    isOpen: false,
  })
  consolePersistence.persist()
}

/**
 * Clear all user data when signing out.
 */
export async function clearUserData(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    resetAllStores()

    // Clear localStorage except for essential app settings
    const keysToKeep = ['next-favicon', 'theme']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))

    logger.info('User data cleared successfully')
  } catch (error) {
    logger.error('Error clearing user data:', { error })
  }
}
