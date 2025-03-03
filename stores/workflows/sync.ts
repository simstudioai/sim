'use client'

import { getAllWorkflowsWithValues } from '.'
import { API_ENDPOINTS } from '../constants'
import { createSingletonSyncManager } from '../sync'

export const workflowSync = createSingletonSyncManager('workflow-sync', () => ({
  endpoint: API_ENDPOINTS.WORKFLOW,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    return {
      workflows: getAllWorkflowsWithValues(),
    }
  },
  method: 'POST',
  syncOnInterval: true,
  syncOnExit: true,
}))
