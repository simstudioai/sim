import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { userStats, workflow as workflowTable } from '@/db/schema'
import type { ExecutionResult } from '@/executor/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)
  return workflows[0]
}

export async function updateWorkflowRunCounts(workflowId: string, runs = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Get the origin from the environment or use direct DB update as fallback
    const origin =
      env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

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
    }
    logger.warn('No origin available, updating workflow stats directly via DB')

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
          totalChatExecutions: 0,
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
  } catch (error) {
    logger.error('Error updating workflow run counts:', error)
    throw error
  }
}

/**
 * Normalize a value for consistent comparison by sorting object keys
 * @param value - The value to normalize
 * @returns A normalized version of the value
 */
function normalizeValue(value: any): any {
  // If not an object or array, return as is
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  // Handle arrays by normalizing each element
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  // For objects, sort keys and normalize each value
  const sortedObj: Record<string, any> = {}

  // Get all keys and sort them
  const sortedKeys = Object.keys(value).sort()

  // Reconstruct object with sorted keys and normalized values
  for (const key of sortedKeys) {
    sortedObj[key] = normalizeValue(value[key])
  }

  return sortedObj
}

/**
 * Generate a normalized JSON string for comparison
 * @param value - The value to normalize and stringify
 * @returns A normalized JSON string
 */
function normalizedStringify(value: any): string {
  return JSON.stringify(normalizeValue(value))
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

  // 1. Compare edges (connections between blocks)
  // First check length
  const currentEdges = currentState.edges || []
  const deployedEdges = deployedState.edges || []

  // Create sorted, normalized representations of the edges for more reliable comparison
  const normalizedCurrentEdges = currentEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }))
    .sort((a, b) =>
      `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
        `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
      )
    )

  const normalizedDeployedEdges = deployedEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }))
    .sort((a, b) =>
      `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
        `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
      )
    )

  // Compare the normalized edge arrays
  if (
    normalizedStringify(normalizedCurrentEdges) !== normalizedStringify(normalizedDeployedEdges)
  ) {
    return true
  }

  // 2. Compare blocks and their configurations
  const currentBlockIds = Object.keys(currentState.blocks || {}).sort()
  const deployedBlockIds = Object.keys(deployedState.blocks || {}).sort()

  // Check if the block IDs are different
  if (
    currentBlockIds.length !== deployedBlockIds.length ||
    normalizedStringify(currentBlockIds) !== normalizedStringify(deployedBlockIds)
  ) {
    return true
  }

  // 3. Build normalized representations of blocks for comparison
  const normalizedCurrentBlocks: Record<string, any> = {}
  const normalizedDeployedBlocks: Record<string, any> = {}

  for (const blockId of currentBlockIds) {
    const currentBlock = currentState.blocks[blockId]
    const deployedBlock = deployedState.blocks[blockId]

    // Skip position as it doesn't affect functionality
    const { position: currentPosition, ...currentBlockProps } = currentBlock
    const { position: deployedPosition, ...deployedBlockProps } = deployedBlock

    // Extract and normalize subBlocks separately for cleaner comparison
    const currentSubBlocks = currentBlockProps.subBlocks || {}
    const deployedSubBlocks = deployedBlockProps.subBlocks || {}

    // Create normalized block representations without position or subBlocks
    normalizedCurrentBlocks[blockId] = {
      ...currentBlockProps,
      subBlocks: undefined,
    }

    normalizedDeployedBlocks[blockId] = {
      ...deployedBlockProps,
      subBlocks: undefined,
    }

    // Handle subBlocks separately
    const _normalizedCurrentSubBlocks: Record<string, any> = {}
    const _normalizedDeployedSubBlocks: Record<string, any> = {}

    // Get all subBlock IDs from both states
    const allSubBlockIds = [
      ...new Set([...Object.keys(currentSubBlocks), ...Object.keys(deployedSubBlocks)]),
    ].sort()

    // Check if any subBlocks are missing in either state
    if (Object.keys(currentSubBlocks).length !== Object.keys(deployedSubBlocks).length) {
      return true
    }

    // Normalize and compare each subBlock
    for (const subBlockId of allSubBlockIds) {
      // If the subBlock doesn't exist in either state, there's a difference
      if (!currentSubBlocks[subBlockId] || !deployedSubBlocks[subBlockId]) {
        return true
      }

      // Get values with special handling for null/undefined
      const currentValue = currentSubBlocks[subBlockId].value ?? null
      const deployedValue = deployedSubBlocks[subBlockId].value ?? null

      // For string values, compare directly to catch even small text changes
      if (typeof currentValue === 'string' && typeof deployedValue === 'string') {
        if (currentValue !== deployedValue) {
          return true
        }
      } else {
        // For other types, use normalized comparison
        const normalizedCurrentValue = normalizeValue(currentValue)
        const normalizedDeployedValue = normalizeValue(deployedValue)

        if (
          normalizedStringify(normalizedCurrentValue) !==
          normalizedStringify(normalizedDeployedValue)
        ) {
          return true
        }
      }

      // Compare type and other properties
      const currentSubBlockWithoutValue = { ...currentSubBlocks[subBlockId], value: undefined }
      const deployedSubBlockWithoutValue = { ...deployedSubBlocks[subBlockId], value: undefined }

      if (
        normalizedStringify(currentSubBlockWithoutValue) !==
        normalizedStringify(deployedSubBlockWithoutValue)
      ) {
        return true
      }
    }

    // Skip the normalization of subBlocks since we've already done detailed comparison above
    const blocksEqual =
      normalizedStringify(normalizedCurrentBlocks[blockId]) ===
      normalizedStringify(normalizedDeployedBlocks[blockId])

    // We've already compared subBlocks in detail
    if (!blocksEqual) {
      return true
    }
  }

  // 4. Compare loops
  const currentLoops = currentState.loops || {}
  const deployedLoops = deployedState.loops || {}

  const currentLoopIds = Object.keys(currentLoops).sort()
  const deployedLoopIds = Object.keys(deployedLoops).sort()

  if (
    currentLoopIds.length !== deployedLoopIds.length ||
    normalizedStringify(currentLoopIds) !== normalizedStringify(deployedLoopIds)
  ) {
    return true
  }

  // Compare each loop with normalized values
  for (const loopId of currentLoopIds) {
    const normalizedCurrentLoop = normalizeValue(currentLoops[loopId])
    const normalizedDeployedLoop = normalizeValue(deployedLoops[loopId])

    if (
      normalizedStringify(normalizedCurrentLoop) !== normalizedStringify(normalizedDeployedLoop)
    ) {
      return true
    }
  }

  return false
}

export function stripCustomToolPrefix(name: string) {
  return name.startsWith('custom_') ? name.replace('custom_', '') : name
}

export const workflowHasResponseBlock = (executionResult: ExecutionResult): boolean => {
  if (
    !executionResult?.logs ||
    !Array.isArray(executionResult.logs) ||
    !executionResult.success ||
    !executionResult.output.response
  ) {
    return false
  }

  const responseBlock = executionResult.logs.find(
    (log) => log?.blockType === 'response' && log?.success
  )

  return responseBlock !== undefined
}

// Create a HTTP response from response block
export const createHttpResponseFromBlock = (executionResult: ExecutionResult): NextResponse => {
  const output = executionResult.output.response
  const { data = {}, status = 200, headers = {} } = output

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return NextResponse.json(data, {
    status: status,
    headers: responseHeaders,
  })
}
