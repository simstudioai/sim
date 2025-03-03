'use client'

import { createSingletonSyncManager } from '@/stores/sync'
import { getAllWorkflowsWithValues } from '.'
import { useWorkflowRegistry } from './registry/store'

const WORKFLOW_ENDPOINT = '/api/db/workflow'

// Prepares workflow data for sync by getting all workflows with their current values
const prepareWorkflowPayload = () => {
  const { workflows } = useWorkflowRegistry.getState()
  if (Object.keys(workflows).length === 0) return null

  // Get all workflows with their current values
  const workflowsWithValues = getAllWorkflowsWithValues()

  return {
    workflows: workflowsWithValues,
  }
}

// Create a single sync manager for all workflow operations
export const workflowSyncManager = createSingletonSyncManager('workflow-sync', () => ({
  endpoint: WORKFLOW_ENDPOINT,
  preparePayload: prepareWorkflowPayload,
  method: 'POST',
}))
