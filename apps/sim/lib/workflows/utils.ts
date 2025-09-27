import { db } from '@sim/db'
import { apiKey, userStats, workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import type { ExecutionResult } from '@/executor/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const workflows = await db
    .select({
      id: workflowTable.id,
      userId: workflowTable.userId,
      workspaceId: workflowTable.workspaceId,
      folderId: workflowTable.folderId,
      name: workflowTable.name,
      description: workflowTable.description,
      color: workflowTable.color,
      lastSynced: workflowTable.lastSynced,
      createdAt: workflowTable.createdAt,
      updatedAt: workflowTable.updatedAt,
      isDeployed: workflowTable.isDeployed,
      deployedState: workflowTable.deployedState,
      deployedAt: workflowTable.deployedAt,
      pinnedApiKeyId: workflowTable.pinnedApiKeyId,
      collaborators: workflowTable.collaborators,
      runCount: workflowTable.runCount,
      lastRunAt: workflowTable.lastRunAt,
      variables: workflowTable.variables,
      isPublished: workflowTable.isPublished,
      marketplaceData: workflowTable.marketplaceData,
      pinnedApiKey: {
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        type: apiKey.type,
        workspaceId: apiKey.workspaceId,
      },
    })
    .from(workflowTable)
    .leftJoin(apiKey, eq(workflowTable.pinnedApiKeyId, apiKey.id))
    .where(eq(workflowTable.id, id))
    .limit(1)

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
      getEnv('NEXT_PUBLIC_APP_URL') || (typeof window !== 'undefined' ? window.location.origin : '')

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
        runCount: (workflow.runCount as number) + runs,
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
        console.warn('User stats record not found - should be created during onboarding', {
          userId: workflow.userId,
        })
        return // Skip stats update if record doesn't exist
      }
      // Update existing record
      await db
        .update(userStats)
        .set({
          totalManualExecutions: userStatsRecord[0].totalManualExecutions + runs,
          lastActive: new Date(),
        })
        .where(eq(userStats.userId, workflow.userId))
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

    // Destructure and exclude non-functional fields
    const { position: _currentPos, subBlocks: currentSubBlocks = {}, ...currentRest } = currentBlock

    const {
      position: _deployedPos,
      subBlocks: deployedSubBlocks = {},
      ...deployedRest
    } = deployedBlock

    normalizedCurrentBlocks[blockId] = {
      ...currentRest,
      subBlocks: undefined,
    }

    normalizedDeployedBlocks[blockId] = {
      ...deployedRest,
      subBlocks: undefined,
    }

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

  // 5. Compare parallels
  const currentParallels = currentState.parallels || {}
  const deployedParallels = deployedState.parallels || {}

  const currentParallelIds = Object.keys(currentParallels).sort()
  const deployedParallelIds = Object.keys(deployedParallels).sort()

  if (
    currentParallelIds.length !== deployedParallelIds.length ||
    normalizedStringify(currentParallelIds) !== normalizedStringify(deployedParallelIds)
  ) {
    return true
  }

  // Compare each parallel with normalized values
  for (const parallelId of currentParallelIds) {
    const normalizedCurrentParallel = normalizeValue(currentParallels[parallelId])
    const normalizedDeployedParallel = normalizeValue(deployedParallels[parallelId])

    if (
      normalizedStringify(normalizedCurrentParallel) !==
      normalizedStringify(normalizedDeployedParallel)
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

/**
 * Validates that the current user has permission to access/modify a workflow
 * Returns session and workflow info if authorized, or error response if not
 */
export async function validateWorkflowPermissions(
  workflowId: string,
  requestId: string,
  action: 'read' | 'write' | 'admin' = 'read'
) {
  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] No authenticated user session for workflow ${action}`)
    return {
      error: { message: 'Unauthorized', status: 401 },
      session: null,
      workflow: null,
    }
  }

  const workflow = await getWorkflowById(workflowId)
  if (!workflow) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return {
      error: { message: 'Workflow not found', status: 404 },
      session: null,
      workflow: null,
    }
  }

  if (workflow.workspaceId) {
    const hasAccess = await hasWorkspaceAdminAccess(session.user.id, workflow.workspaceId)
    if (!hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} in workspace ${workflow.workspaceId}`
      )
      return {
        error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
        session: null,
        workflow: null,
      }
    }
  } else {
    if (workflow.userId !== session.user.id) {
      logger.warn(
        `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} owned by ${workflow.userId}`
      )
      return {
        error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
        session: null,
        workflow: null,
      }
    }
  }

  return {
    error: null,
    session,
    workflow,
  }
}
