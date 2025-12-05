import type { QueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OptimisticMutation')

/**
 * Configuration for creating an optimistic mutation
 */
export interface OptimisticMutationConfig<TData, TVariables, TItem, TContext> {
  /** Name for logging purposes */
  name: string
  /** Query keys to cancel and invalidate */
  getQueryKey: (variables: TVariables) => readonly unknown[]
  /** Get current state snapshot for rollback */
  getSnapshot: () => Record<string, TItem>
  /** Generate a temporary ID for the optimistic entry */
  generateTempId: () => string
  /** Create the optimistic item to insert */
  createOptimisticItem: (variables: TVariables, tempId: string) => TItem
  /** Apply optimistic update to state */
  applyOptimisticUpdate: (tempId: string, item: TItem) => void
  /** Replace temp entry with real data on success */
  replaceOptimisticEntry: (tempId: string, data: TData) => void
  /** Rollback state on error */
  rollback: (snapshot: Record<string, TItem>) => void
  /** Optional additional success handler */
  onSuccessExtra?: (data: TData, variables: TVariables) => void
}

/**
 * Context returned by onMutate for use in onSuccess/onError
 */
export interface OptimisticMutationContext<TItem> {
  tempId: string
  previousState: Record<string, TItem>
}

/**
 * Creates mutation lifecycle handlers for optimistic updates
 *
 * @param queryClient - React Query client
 * @param config - Configuration for the optimistic mutation
 * @returns Object with onMutate, onSuccess, onError, and onSettled handlers
 */
export function createOptimisticMutationHandlers<TData, TVariables, TItem>(
  queryClient: QueryClient,
  config: OptimisticMutationConfig<TData, TVariables, TItem, OptimisticMutationContext<TItem>>
) {
  const {
    name,
    getQueryKey,
    getSnapshot,
    generateTempId,
    createOptimisticItem,
    applyOptimisticUpdate,
    replaceOptimisticEntry,
    rollback,
    onSuccessExtra,
  } = config

  return {
    onMutate: async (variables: TVariables): Promise<OptimisticMutationContext<TItem>> => {
      const queryKey = getQueryKey(variables)

      // Cancel any outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey })

      // Snapshot previous state for rollback
      const previousState = getSnapshot()

      // Generate temp ID and create optimistic item
      const tempId = generateTempId()
      const optimisticItem = createOptimisticItem(variables, tempId)

      // Apply optimistic update
      applyOptimisticUpdate(tempId, optimisticItem)

      logger.info(`[${name}] Added optimistic entry: ${tempId}`)
      return { tempId, previousState }
    },

    onSuccess: (data: TData, variables: TVariables, context: OptimisticMutationContext<TItem>) => {
      logger.info(`[${name}] Success, replacing temp entry ${context.tempId}`)

      // Replace optimistic entry with real data
      replaceOptimisticEntry(context.tempId, data)

      // Call extra success handler if provided
      onSuccessExtra?.(data, variables)
    },

    onError: (
      error: Error,
      _variables: TVariables,
      context: OptimisticMutationContext<TItem> | undefined
    ) => {
      logger.error(`[${name}] Failed:`, error)

      // Rollback to previous state
      if (context?.previousState) {
        rollback(context.previousState)
        logger.info(`[${name}] Rolled back to previous state`)
      }
    },

    onSettled: (_data: TData | undefined, _error: Error | null, variables: TVariables) => {
      // Always invalidate to sync with server state
      queryClient.invalidateQueries({ queryKey: getQueryKey(variables) })
    },
  }
}

/**
 * Generates a temporary ID with a given prefix
 */
export function generateTempId(prefix: string): string {
  return `${prefix}-${Date.now()}`
}
