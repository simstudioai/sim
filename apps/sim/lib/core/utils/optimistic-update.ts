import { createLogger } from '@sim/logger'

const logger = createLogger('OptimisticUpdate')

/**
 * Options for performing an optimistic update with automatic rollback on error
 */
export interface OptimisticUpdateOptions<T> {
  /**
   * Function that returns the current state value (for rollback purposes)
   */
  getCurrentState: () => T
  /**
   * Function that performs the optimistic update to the UI state
   */
  optimisticUpdate: () => void
  /**
   * Async function that performs the actual API call
   */
  apiCall: () => Promise<void>
  /**
   * Function that rolls back the state to the original value
   * @param originalValue - The value returned by getCurrentState before the update
   */
  rollback: (originalValue: T) => void
  /**
   * Optional error message to log if the operation fails
   */
  errorMessage?: string
  /**
   * Optional callback to execute on error (e.g., show toast notification)
   */
  onError?: (error: Error, originalValue: T) => void
  /**
   * Optional callback that always runs regardless of success or error (e.g., to clear loading states)
   */
  onComplete?: () => void
}

/**
 * Performs an optimistic update with automatic rollback on error.
 * This utility standardizes the pattern of:
 * 1. Save current state
 * 2. Update UI optimistically
 * 3. Make API call
 * 4. Rollback on error
 *
 * @example
 * ```typescript
 * await withOptimisticUpdate({
 *   getCurrentState: () => get().folders[id],
 *   optimisticUpdate: () => set(state => ({
 *     folders: { ...state.folders, [id]: { ...folder, name: newName } }
 *   })),
 *   apiCall: async () => {
 *     await fetch(`/api/folders/${id}`, {
 *       method: 'PUT',
 *       body: JSON.stringify({ name: newName })
 *     })
 *   },
 *   rollback: (originalFolder) => set(state => ({
 *     folders: { ...state.folders, [id]: originalFolder }
 *   })),
 *   errorMessage: 'Failed to rename folder',
 *   onError: (error) => toast.error('Could not rename folder')
 * })
 * ```
 */
export async function withOptimisticUpdate<T>(options: OptimisticUpdateOptions<T>): Promise<void> {
  const {
    getCurrentState,
    optimisticUpdate,
    apiCall,
    rollback,
    errorMessage,
    onError,
    onComplete,
  } = options

  const originalValue = getCurrentState()

  optimisticUpdate()

  try {
    await apiCall()
  } catch (error) {
    rollback(originalValue)

    if (errorMessage) {
      logger.error(errorMessage, { error })
    }

    if (onError && error instanceof Error) {
      onError(error, originalValue)
    }

    throw error
  } finally {
    if (onComplete) {
      onComplete()
    }
  }
}
