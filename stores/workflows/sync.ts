'use client'

import { createLogger } from '@/lib/logs/console-logger'
import { getAllWorkflowsWithValues } from '.'
import { API_ENDPOINTS } from '../constants'
import { createSingletonSyncManager } from '../sync'
import { useWorkflowRegistry } from './registry/store'
import { WorkflowMetadata } from './registry/types'
import { useSubBlockStore } from './subblock/store'
import { useWorkflowStore } from './workflow/store'
import { BlockState } from './workflow/types'

const logger = createLogger('Workflows Sync')

// Flag to prevent immediate sync back to DB after loading from DB
let isLoadingFromDB = false

// Track workflows that had scheduling enabled in previous syncs
const scheduledWorkflows = new Set<string>()

/**
 * Checks if a workflow has scheduling enabled
 * @param blocks The workflow blocks
 * @returns true if scheduling is enabled, false otherwise
 */
function hasSchedulingEnabled(blocks: Record<string, BlockState>): boolean {
  // Find the starter block
  const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
  if (!starterBlock) return false

  // Check if the startWorkflow value is 'schedule'
  const startWorkflow = starterBlock.subBlocks.startWorkflow?.value
  return startWorkflow === 'schedule'
}

/**
 * Updates or cancels the schedule for a workflow based on its current configuration
 * @param workflowId The workflow ID
 * @param state The workflow state
 * @returns A promise that resolves when the schedule update is complete
 */
async function updateWorkflowSchedule(workflowId: string, state: any): Promise<void> {
  try {
    const isScheduleEnabled = hasSchedulingEnabled(state.blocks)

    // Always call the schedule API to either update or cancel the schedule
    // The API will handle the logic to create, update, or delete the schedule
    const response = await fetch(API_ENDPOINTS.SCHEDULE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        state,
      }),
    })

    if (!response.ok) {
      logger.error(
        `Failed to ${isScheduleEnabled ? 'update' : 'cancel'} schedule for workflow ${workflowId}:`,
        response.statusText
      )
      return
    }

    const result = await response.json()

    // Update our tracking of scheduled workflows
    if (isScheduleEnabled) {
      scheduledWorkflows.add(workflowId)
      logger.info(`Schedule updated for workflow ${workflowId}:`, result)
    } else {
      scheduledWorkflows.delete(workflowId)
      logger.info(`Schedule cancelled for workflow ${workflowId}:`, result)
    }
  } catch (error) {
    logger.error(`Error managing schedule for workflow ${workflowId}:`, { error })
  }
}

/**
 * Fetches workflows from the database and updates the local stores
 * This function handles backwards syncing on initialization
 */
export async function fetchWorkflowsFromDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Set flag to prevent sync back to DB during loading
    isLoadingFromDB = true

    // Call the API endpoint to get workflows from DB
    const response = await fetch(API_ENDPOINTS.WORKFLOW, {
      method: 'GET',
    })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        return
      }

      logger.error('Failed to fetch workflows:', response.statusText)
      return
    }

    const { data } = await response.json()

    if (!data || !Array.isArray(data) || data.length === 0) {
      logger.info('No workflows found in database')
      return
    }

    // Get the current active workflow ID before processing
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

    // Process workflows and update stores
    const registryWorkflows: Record<string, WorkflowMetadata> = {}

    // Process each workflow from the database
    data.forEach((workflow) => {
      const {
        id,
        name,
        description,
        color,
        state,
        lastSynced,
        isDeployed,
        deployedAt,
        apiKey,
        createdAt,
      } = workflow

      // 1. Update registry store with workflow metadata
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        // Use createdAt for sorting if available, otherwise fall back to lastSynced
        lastModified: createdAt ? new Date(createdAt) : new Date(lastSynced),
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

      // 7. Track if this workflow has scheduling enabled
      if (hasSchedulingEnabled(workflowState.blocks)) {
        scheduledWorkflows.add(id)
      }
    })

    // 8. Update registry store with all workflows
    useWorkflowRegistry.setState({ workflows: registryWorkflows })

    // 9. If there's an active workflow that wasn't in the DB data, set a new active workflow
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

    logger.info('Workflows loaded from DB:', Object.keys(registryWorkflows).length)
  } catch (error) {
    logger.error('Error fetching workflows from DB:', { error })
  } finally {
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isLoadingFromDB = false
    }, 500)
  }
}

// Syncs workflows to the database
export const workflowSync = createSingletonSyncManager('workflow-sync', () => ({
  endpoint: API_ENDPOINTS.WORKFLOW,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    // Skip sync if we're currently loading from DB to prevent overwriting DB data
    if (isLoadingFromDB) {
      logger.info('Skipping workflow sync while loading from DB')
      return { skipSync: true }
    }

    // Get all workflows with values
    const workflowsData = getAllWorkflowsWithValues()

    // Skip sync if there are no workflows to sync
    if (Object.keys(workflowsData).length === 0) {
      logger.info('Skipping workflow sync - no workflows to sync')
      return { skipSync: true }
    }

    return {
      workflows: workflowsData,
    }
  },
  method: 'POST',
  syncOnInterval: true,
  syncOnExit: true,
  onSyncSuccess: async (data) => {
    logger.info('Workflows synced to DB successfully')

    // After successful sync to DB, update schedules for all workflows
    try {
      const workflowsData = getAllWorkflowsWithValues()
      const currentWorkflowIds = new Set(Object.keys(workflowsData))

      // Process each workflow to update its schedule if needed
      const schedulePromises = Object.entries(workflowsData).map(async ([id, workflow]) => {
        const isCurrentlyScheduled = hasSchedulingEnabled(workflow.state.blocks)
        const wasScheduledBefore = scheduledWorkflows.has(id)

        // Only update schedule if the scheduling status has changed or it's currently scheduled
        // This ensures we update schedules when they change and cancel them when they're disabled
        if (isCurrentlyScheduled || wasScheduledBefore) {
          await updateWorkflowSchedule(id, workflow.state)
        }
      })

      // Wait for all schedule updates to complete
      await Promise.all(schedulePromises)

      // Clean up tracking for workflows that no longer exist
      for (const id of scheduledWorkflows) {
        if (!currentWorkflowIds.has(id)) {
          scheduledWorkflows.delete(id)
        }
      }
    } catch (error) {
      logger.error('Error updating workflow schedules:', { error })
    }
  },
}))
