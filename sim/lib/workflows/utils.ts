import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowState } from '@/stores/workflows/workflow/types'
import { db } from '@/db'
import { userStats, workflow as workflowTable } from '@/db/schema'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)
  return workflows[0]
}

export async function updateWorkflowRunCounts(workflowId: string, runs: number = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Get the origin from the environment or use direct DB update as fallback
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '')

    if (origin) {
      // Use absolute URL with origin
      const response = await fetch(`${origin}/api/workflows/${workflowId}/stats?runs=${runs}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update workflow stats')
      }

      return response.json()
    } else {
      logger.warn(`No origin available, updating workflow stats directly via DB`)

      // Update workflow directly through database
      await db
        .update(workflowTable)
        .set({
          runCount: workflow.runCount + runs,
          lastRunAt: new Date(),
        })
        .where(eq(workflowTable.id, workflowId))

      // Update user stats if needed
      if (workflow.userId) {
        const userStatsRecord = await db
          .select()
          .from(userStats)
          .where(eq(userStats.userId, workflow.userId))
          .limit(1)

        if (userStatsRecord.length === 0) {
          // Create new record
          await db.insert(userStats).values({
            id: crypto.randomUUID(),
            userId: workflow.userId,
            totalManualExecutions: runs,
            totalApiCalls: 0,
            totalWebhookTriggers: 0,
            totalScheduledExecutions: 0,
            totalTokensUsed: 0,
            totalCost: '0.00',
            lastActive: new Date(),
          })
        } else {
          // Update existing record
          await db
            .update(userStats)
            .set({
              totalManualExecutions: userStatsRecord[0].totalManualExecutions + runs,
              lastActive: new Date(),
            })
            .where(eq(userStats.userId, workflow.userId))
        }
      }

      return { success: true, runsAdded: runs }
    }
  } catch (error) {
    logger.error(`Error updating workflow run counts:`, error)
    throw error
  }
}

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes
 * @param currentState - The current workflow state
 * @param deployedState - The deployed workflow state
 * @returns True if there are meaningful changes, false if only position changes or no changes
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  // If no deployed state exists, then the workflow has changed
  if (!deployedState) return true

  // Check edges for changes (connections between blocks)
  const currentEdges = currentState.edges || []
  const deployedEdges = deployedState.edges || []

  if (currentEdges.length !== deployedEdges.length) {
    return true
  }

  // Compare edges (connections between blocks)
  // Create a map of edge IDs to make comparison easier
  const edgeMap = new Map()
  for (const edge of deployedEdges) {
    const key = `${edge.source}-${edge.sourceHandle}-${edge.target}-${edge.targetHandle}`
    edgeMap.set(key, true)
  }

  for (const edge of currentEdges) {
    const key = `${edge.source}-${edge.sourceHandle}-${edge.target}-${edge.targetHandle}`
    if (!edgeMap.has(key)) {
      return true
    }
  }

  // Check for block changes (added/removed blocks)
  const currentBlockIds = Object.keys(currentState.blocks || {})
  const deployedBlockIds = Object.keys(deployedState.blocks || {})

  if (currentBlockIds.length !== deployedBlockIds.length) {
    return true
  }

  // Check if any blocks were added or removed
  for (const blockId of currentBlockIds) {
    if (!deployedState.blocks[blockId]) {
      return true
    }
  }

  // Check for configuration changes within blocks (except position)
  for (const blockId of currentBlockIds) {
    const currentBlock = currentState.blocks[blockId]
    const deployedBlock = deployedState.blocks[blockId]

    // Skip position comparison (x, y coordinates)
    const { position: currentPosition, ...currentBlockProps } = currentBlock
    const { position: deployedPosition, ...deployedBlockProps } = deployedBlock

    // Check subBlocks for changes
    const currentSubBlocks = currentBlockProps.subBlocks || {}
    const deployedSubBlocks = deployedBlockProps.subBlocks || {}

    // Compare subblock IDs
    const currentSubBlockIds = Object.keys(currentSubBlocks)
    const deployedSubBlockIds = Object.keys(deployedSubBlocks)

    if (currentSubBlockIds.length !== deployedSubBlockIds.length) {
      return true
    }

    // Check for changes in subblock values
    for (const subBlockId of currentSubBlockIds) {
      if (!deployedSubBlocks[subBlockId]) {
        return true
      }

      const currentValue = currentSubBlocks[subBlockId].value
      const deployedValue = deployedSubBlocks[subBlockId].value

      // Deep compare values - convert to JSON and back to handle complex objects
      if (JSON.stringify(currentValue) !== JSON.stringify(deployedValue)) {
        return true
      }
    }

    // Check other block properties (type, data, etc.)
    if (currentBlockProps.type !== deployedBlockProps.type) {
      return true
    }

    // Compare other block properties by converting to JSON
    const currentPropsJson = JSON.stringify({
      ...currentBlockProps,
      subBlocks: undefined,
    })

    const deployedPropsJson = JSON.stringify({
      ...deployedBlockProps,
      subBlocks: undefined,
    })

    if (currentPropsJson !== deployedPropsJson) {
      return true
    }
  }

  // Check loops for changes
  const currentLoops = currentState.loops || {}
  const deployedLoops = deployedState.loops || {}

  if (Object.keys(currentLoops).length !== Object.keys(deployedLoops).length) {
    return true
  }

  // Compare loop configurations
  for (const loopId in currentLoops) {
    if (!deployedLoops[loopId]) {
      return true
    }

    // Compare loop properties
    if (JSON.stringify(currentLoops[loopId]) !== JSON.stringify(deployedLoops[loopId])) {
      return true
    }
  }

  // No meaningful changes detected
  return false
}
