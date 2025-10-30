import { db } from '@sim/db'
import { permissions, workflow as workflowTable, workspace } from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { PermissionType } from '@/lib/permissions/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import type { ExecutionResult } from '@/executor/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowUtils')

type WorkflowSelection = InferSelectModel<typeof workflowTable>

export async function getWorkflowById(id: string) {
  const rows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)

  return rows[0]
}

type WorkflowRecord = ReturnType<typeof getWorkflowById> extends Promise<infer R>
  ? NonNullable<R>
  : never

export interface WorkflowAccessContext {
  workflow: WorkflowRecord
  workspaceOwnerId: string | null
  workspacePermission: PermissionType | null
  isOwner: boolean
  isWorkspaceOwner: boolean
}

export async function getWorkflowAccessContext(
  workflowId: string,
  userId?: string
): Promise<WorkflowAccessContext | null> {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow) {
    return null
  }

  let workspaceOwnerId: string | null = null
  let workspacePermission: PermissionType | null = null

  if (workflow.workspaceId) {
    const [workspaceRow] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workflow.workspaceId))
      .limit(1)

    workspaceOwnerId = workspaceRow?.ownerId ?? null

    if (userId) {
      const [permissionRow] = await db
        .select({ permissionType: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflow.workspaceId)
          )
        )
        .limit(1)

      workspacePermission = permissionRow?.permissionType ?? null
    }
  }

  const resolvedUserId = userId ?? null

  const isOwner = resolvedUserId ? workflow.userId === resolvedUserId : false
  const isWorkspaceOwner = resolvedUserId ? workspaceOwnerId === resolvedUserId : false

  return {
    workflow,
    workspaceOwnerId,
    workspacePermission,
    isOwner,
    isWorkspaceOwner,
  }
}

export async function updateWorkflowRunCounts(workflowId: string, runs = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Use the API to update stats
    const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}/stats?runs=${runs}`, {
      method: 'POST',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update workflow stats')
    }

    return response.json()
  } catch (error) {
    logger.error(`Error updating workflow stats for ${workflowId}`, error)
    throw error
  }
}

/**
 * Sanitize tools array by removing UI-only fields
 * @param tools - The tools array to sanitize
 * @returns A sanitized tools array
 */
function sanitizeToolsForComparison(tools: any[] | undefined): any[] {
  if (!Array.isArray(tools)) {
    return []
  }

  return tools.map((tool) => {
    // Remove UI-only field: isExpanded
    const { isExpanded, ...cleanTool } = tool
    return cleanTool
  })
}

/**
 * Sanitize inputFormat array by removing test-only value fields
 * @param inputFormat - The inputFormat array to sanitize
 * @returns A sanitized inputFormat array without test values
 */
function sanitizeInputFormatForComparison(inputFormat: any[] | undefined): any[] {
  if (!Array.isArray(inputFormat)) {
    return []
  }

  return inputFormat.map((field) => {
    // Remove test-only field: value (used only for manual testing)
    const { value, collapsed, ...cleanField } = field
    return cleanField
  })
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
      let currentValue = currentSubBlocks[subBlockId].value ?? null
      let deployedValue = deployedSubBlocks[subBlockId].value ?? null

      // Special handling for 'tools' subBlock - sanitize UI-only fields
      if (subBlockId === 'tools' && Array.isArray(currentValue) && Array.isArray(deployedValue)) {
        currentValue = sanitizeToolsForComparison(currentValue)
        deployedValue = sanitizeToolsForComparison(deployedValue)
      }

      // Special handling for 'inputFormat' subBlock - sanitize UI-only fields (collapsed state)
      if (
        subBlockId === 'inputFormat' &&
        Array.isArray(currentValue) &&
        Array.isArray(deployedValue)
      ) {
        currentValue = sanitizeInputFormatForComparison(currentValue)
        deployedValue = sanitizeInputFormatForComparison(deployedValue)
      }

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

  const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
  if (!accessContext) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return {
      error: { message: 'Workflow not found', status: 404 },
      session: null,
      workflow: null,
    }
  }

  const { workflow, workspacePermission, isOwner } = accessContext

  if (isOwner) {
    return {
      error: null,
      session,
      workflow,
    }
  }

  if (workflow.workspaceId) {
    let hasPermission = false

    if (action === 'read') {
      // Any workspace permission allows read
      hasPermission = workspacePermission !== null
    } else if (action === 'write') {
      // Write or admin permission allows write
      hasPermission = workspacePermission === 'write' || workspacePermission === 'admin'
    } else if (action === 'admin') {
      // Only admin permission allows admin actions
      hasPermission = workspacePermission === 'admin'
    }

    if (!hasPermission) {
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
    logger.warn(
      `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} owned by ${workflow.userId}`
    )
    return {
      error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
      session: null,
      workflow: null,
    }
  }

  return {
    error: null,
    session,
    workflow,
  }
}
