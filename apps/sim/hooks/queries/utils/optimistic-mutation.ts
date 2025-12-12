import type { QueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OptimisticMutation')

export interface OptimisticMutationConfig<TData, TVariables, TItem, TContext> {
  name: string
  getQueryKey: (variables: TVariables) => readonly unknown[]
  getSnapshot: () => Record<string, TItem>
  generateTempId: () => string
  createOptimisticItem: (variables: TVariables, tempId: string) => TItem
  applyOptimisticUpdate: (tempId: string, item: TItem) => void
  replaceOptimisticEntry: (tempId: string, data: TData) => void
  rollback: (snapshot: Record<string, TItem>) => void
  onSuccessExtra?: (data: TData, variables: TVariables) => void
}

export interface OptimisticMutationContext<TItem> {
  tempId: string
  previousState: Record<string, TItem>
}

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
      await queryClient.cancelQueries({ queryKey })
      const previousState = getSnapshot()
      const tempId = generateTempId()
      const optimisticItem = createOptimisticItem(variables, tempId)
      applyOptimisticUpdate(tempId, optimisticItem)
      logger.info(`[${name}] Added optimistic entry: ${tempId}`)
      return { tempId, previousState }
    },

    onSuccess: (data: TData, variables: TVariables, context: OptimisticMutationContext<TItem>) => {
      logger.info(`[${name}] Success, replacing temp entry ${context.tempId}`)
      replaceOptimisticEntry(context.tempId, data)
      onSuccessExtra?.(data, variables)
    },

    onError: (
      error: Error,
      _variables: TVariables,
      context: OptimisticMutationContext<TItem> | undefined
    ) => {
      logger.error(`[${name}] Failed:`, error)
      if (context?.previousState) {
        rollback(context.previousState)
        logger.info(`[${name}] Rolled back to previous state`)
      }
    },

    onSettled: (_data: TData | undefined, _error: Error | null, variables: TVariables) => {
      queryClient.invalidateQueries({ queryKey: getQueryKey(variables) })
    },
  }
}

export function generateTempId(prefix: string): string {
  return `${prefix}-${Date.now()}`
}
