import { useCallback } from 'react'
import type { AutoLayoutOptions } from '../utils/auto-layout-utils'
import { applyAutoLayoutAndUpdateStore as applyAutoLayoutStandalone } from '../utils/auto-layout-utils'

export type { AutoLayoutOptions }

/**
 * Hook providing auto-layout functionality for workflows
 * Binds workflowId context and provides memoized callback for React components
 */
export function useAutoLayout(workflowId: string | null) {
  const applyAutoLayoutAndUpdateStore = useCallback(
    async (options: AutoLayoutOptions = {}) => {
      if (!workflowId) {
        return { success: false, error: 'No workflow ID provided' }
      }
      return applyAutoLayoutStandalone(workflowId, options)
    },
    [workflowId]
  )

  return {
    applyAutoLayoutAndUpdateStore,
  }
}
