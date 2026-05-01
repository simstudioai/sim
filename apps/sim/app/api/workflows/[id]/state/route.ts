import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { putWorkflowNormalizedStateContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/sanitization/validation'
import { validateEdges } from '@/stores/workflows/workflow/edge-validation'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowStateAPI')

/**
 * GET /api/workflows/[id]/state
 * Fetch the current workflow state from normalized tables.
 * Used by the client after server-side edits (edit_workflow) to stay in sync.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: workflowId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const normalized = await loadWorkflowFromNormalizedTables(workflowId)
      if (!normalized) {
        return NextResponse.json({ error: 'Workflow state not found' }, { status: 404 })
      }

      // Stamp `workflowId` from the path param on each variable so the
      // global client-side variables store can filter by workflow without
      // requiring clients to thread the path param through. The read
      // contract requires this server-stamped field.
      const persistedVariables =
        (authorization.workflow?.variables as Record<string, Record<string, unknown>>) || {}
      const variables: Record<string, Record<string, unknown>> = {}
      for (const [variableId, variable] of Object.entries(persistedVariables)) {
        if (variable && typeof variable === 'object') {
          variables[variableId] = { ...variable, workflowId }
        }
      }

      return NextResponse.json({
        blocks: normalized.blocks,
        edges: normalized.edges,
        loops: normalized.loops || {},
        parallels: normalized.parallels || {},
        variables,
      })
    } catch (error) {
      logger.error('Failed to fetch workflow state', {
        workflowId,
        error: toError(error).message,
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized state update attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const parsed = await parseRequest(putWorkflowNormalizedStateContract, request, context)
      if (!parsed.success) return parsed.response
      const state = parsed.data.body

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'write',
      })
      const workflowData = authorization.workflow

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} not found for state update`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const canUpdate = authorization.allowed

      if (!canUpdate) {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to update workflow state ${workflowId}`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      // Note: prior versions cross-checked that each variable's `workflowId`
      // equalled the path param. The write contract does not carry `workflowId`
      // per variable (the path param is the source of truth), so the check
      // is unreachable and was removed.

      // Sanitize custom tools in agent blocks before saving
      const { blocks: sanitizedBlocks, warnings } = sanitizeAgentToolsInBlocks(
        state.blocks as Record<string, BlockState>
      )

      // Save to normalized tables
      // Ensure all required fields are present for WorkflowState type
      // Filter out blocks without type or name before saving
      const filteredBlocks = Object.entries(sanitizedBlocks).reduce(
        (acc, [blockId, block]: [string, BlockState]) => {
          if (block.type && block.name) {
            // Ensure all required fields are present
            acc[blockId] = {
              ...block,
              enabled: block.enabled !== undefined ? block.enabled : true,
              horizontalHandles:
                block.horizontalHandles !== undefined ? block.horizontalHandles : true,
              height: block.height !== undefined ? block.height : 0,
              subBlocks: block.subBlocks || {},
              outputs: block.outputs || {},
            }
          }
          return acc
        },
        {} as typeof state.blocks
      )

      const typedBlocks = filteredBlocks as Record<string, BlockState>
      const validatedEdges = validateEdges(state.edges as WorkflowState['edges'], typedBlocks)
      const validationWarnings = validatedEdges.dropped.map(
        ({ edge, reason }) => `Dropped edge "${edge.id}": ${reason}`
      )
      const canonicalLoops = generateLoopBlocks(typedBlocks)
      const canonicalParallels = generateParallelBlocks(typedBlocks)

      const workflowState = {
        blocks: filteredBlocks,
        edges: validatedEdges.valid,
        loops: canonicalLoops,
        parallels: canonicalParallels,
        lastSaved: state.lastSaved || Date.now(),
        isDeployed: state.isDeployed || false,
        deployedAt: state.deployedAt,
      }

      const saveResult = await saveWorkflowToNormalizedTables(
        workflowId,
        workflowState as WorkflowState
      )

      if (!saveResult.success) {
        logger.error(
          `[${requestId}] Failed to save workflow ${workflowId} state:`,
          saveResult.error
        )
        return NextResponse.json(
          { error: 'Failed to save workflow state', details: saveResult.error },
          { status: 500 }
        )
      }

      // Extract and persist custom tools to database
      try {
        const workspaceId = workflowData.workspaceId
        if (workspaceId) {
          const { saved, errors } = await extractAndPersistCustomTools(
            workflowState,
            workspaceId,
            userId
          )

          if (saved > 0) {
            logger.info(`[${requestId}] Persisted ${saved} custom tool(s) to database`, {
              workflowId,
            })
          }

          if (errors.length > 0) {
            logger.warn(`[${requestId}] Some custom tools failed to persist`, {
              errors,
              workflowId,
            })
          }
        } else {
          logger.warn(
            `[${requestId}] Workflow has no workspaceId, skipping custom tools persistence`,
            {
              workflowId,
            }
          )
        }
      } catch (error) {
        logger.error(`[${requestId}] Failed to persist custom tools`, { error, workflowId })
      }

      // Update workflow's lastSynced timestamp and variables if provided
      const updateData: any = {
        lastSynced: new Date(),
        updatedAt: new Date(),
      }

      // If variables are provided in the state, update them in the workflow record
      if (state.variables !== undefined) {
        updateData.variables = state.variables
      }

      await db.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

      try {
        const notifyResponse = await fetch(`${getSocketServerUrl()}/api/workflow-updated`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.INTERNAL_API_SECRET,
          },
          body: JSON.stringify({ workflowId }),
        })

        if (!notifyResponse.ok) {
          logger.warn(
            `[${requestId}] Failed to notify Socket.IO server about workflow ${workflowId} update`
          )
        }
      } catch (notificationError) {
        logger.warn(
          `[${requestId}] Error notifying Socket.IO server about workflow ${workflowId} update`,
          notificationError
        )
      }

      return NextResponse.json(
        { success: true, warnings: [...warnings, ...validationWarnings] },
        { status: 200 }
      )
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      logger.error(
        `[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`,
        error
      )

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
