'use client'

import { getAllWorkflowsWithValues } from '.'
import { API_ENDPOINTS } from '../constants'
import { createSingletonSyncManager } from '../sync'
import { useWorkflowRegistry } from './registry/store'
import { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'
import { BlockState, WorkflowState } from './workflow/types'

/**
 * Fetches workflows from the database and updates the local stores
 * This function handles backwards syncing on initialization
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Call the API endpoint to get workflows from DB
    const response = await fetch(API_ENDPOINTS.WORKFLOW, {
      method: 'GET',
    })

    if (!response.ok) {
      if (response.status === 401) {
        console.warn('User not authenticated for workflow fetch')
        return
      }

      console.error('Failed to fetch workflows:', response.statusText)
      return
    }

    const { data } = await response.json()

    if (!data || !Array.isArray(data) || data.length === 0) {
      console.log('No workflows found in database')
      return
    }

    // Get the current active workflow ID before processing
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

    // Process workflows and update stores
    const registryWorkflows: Record<string, WorkflowMetadata> = {}

    // Process each workflow from the database
    data.forEach((workflow) => {
      const { id, name, description, color, state, lastSynced, isDeployed, deployedAt, apiKey } =
        workflow

      // 1. Update registry store with workflow metadata
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        lastModified: new Date(lastSynced),
      }

      // 2. Prepare workflow state data
      const workflowState = {
        blocks: state.blocks || {},
        edges: state.edges || [],
        loops: state.loops || {},
        isDeployed: isDeployed || false,
        deployedAt: deployedAt ? new Date(deployedAt) : undefined,
        apiKey,
        lastSaved: Date.now(),
      }

      // 3. Initialize subblock values from the workflow state
      const subblockValues: Record<string, Record<string, any>> = {}

      // Extract subblock values from blocks
      Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
        const blockState = block as BlockState
        subblockValues[blockId] = {}

        Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
          subblockValues[blockId][subblockId] = subblock.value
        })
      })

      // 4. Store the workflow state and subblock values in localStorage
      // This ensures compatibility with existing code that loads from localStorage
      localStorage.setItem(`workflow-${id}`, JSON.stringify(workflowState))
      localStorage.setItem(`subblock-values-${id}`, JSON.stringify(subblockValues))

      // 5. Update subblock store for this workflow
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [id]: subblockValues,
        },
      }))

      // 6. If this is the active workflow, update the workflow store
      if (id === activeWorkflowId) {
        useWorkflowStore.setState(workflowState)
      }
    })

    // 7. Update registry store with all workflows
    useWorkflowRegistry.setState({ workflows: registryWorkflows })

    // 8. If there's an active workflow that wasn't in the DB data, set a new active workflow
    if (activeWorkflowId && !registryWorkflows[activeWorkflowId]) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]
      if (firstWorkflowId) {
        // Load the first workflow as active
        const workflowState = JSON.parse(
          localStorage.getItem(`workflow-${firstWorkflowId}`) || '{}'
        )
        if (Object.keys(workflowState).length > 0) {
          useWorkflowStore.setState(workflowState)
          useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
        }
      }
    }

    console.log('Workflows loaded from DB:', Object.keys(registryWorkflows).length)
  } catch (error) {
    console.error('Error fetching workflows from DB:', error)
  }
}

// Syncs workflows to the database
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
  onSyncSuccess: (data) => {
    console.log('Workflows synced to DB successfully')
  },
}))
