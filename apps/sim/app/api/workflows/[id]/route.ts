import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getWorkflowResponseDataSchema,
  getWorkflowStateContract,
  updateWorkflowContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalWorkflowSessionOrExecutorAuth } from '@/lib/workflows/api'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { performDeleteWorkflow, performUpdateWorkflow } from '@/lib/workflows/orchestration'
import { getWorkflowById } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowByIdAPI')

export const GET = defineInternalJsonRoute({
  contract: getWorkflowStateContract,
  auth: internalWorkflowSessionOrExecutorAuth,
  operation: readWorkflowDefinition.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal workflow read behavior',
  }),
  errorPolicy: internalPlainOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workflowId: params.id, state: 'draft' as const }),
  useCase: readWorkflowDefinition,
  present: ({ workflow: workflowData, state }) => {
    const persistedVariables =
      (workflowData.variables as Record<string, Record<string, unknown>>) || {}
    const stampedVariables: Record<string, Record<string, unknown>> = {}
    for (const [variableId, variable] of Object.entries(persistedVariables)) {
      if (variable && typeof variable === 'object') {
        stampedVariables[variableId] = { ...variable, workflowId: workflowData.id }
      }
    }
    const workflowStateMetadata = {
      name: workflowData.name,
      ...(typeof workflowData.description === 'string'
        ? { description: workflowData.description }
        : {}),
    }
    return {
      data: getWorkflowResponseDataSchema.parse({
        ...workflowData,
        state: {
          blocks: state?.blocks ?? {},
          edges: state?.edges ?? [],
          loops: state?.loops ?? {},
          parallels: state?.parallels ?? {},
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed || false,
          deployedAt: workflowData.deployedAt,
          metadata: workflowStateMetadata,
        },
        variables: stampedVariables,
      }),
    }
  },
  onSuccess: ({ result }) => {
    logger.info('Successfully fetched workflow', { workflowId: result.workflow.id })
  },
})

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow by ID
 */
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized deletion attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = auth.userId

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'write',
      })
      const workflowData = authorization.workflow || (await getWorkflowById(workflowId))

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const canDelete = authorization.allowed

      if (!canDelete) {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      await assertWorkflowMutable(workflowId)

      const result = await performDeleteWorkflow({
        workflowId,
        userId,
        requestId,
      })

      if (!result.success) {
        const status =
          result.errorCode === 'not_found' ? 404 : result.errorCode === 'validation' ? 400 : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      captureServerEvent(
        userId,
        'workflow_deleted',
        { workflow_id: workflowId, workspace_id: workflowData.workspaceId ?? '' },
        workflowData.workspaceId ? { groups: { workspace: workflowData.workspaceId } } : undefined
      )

      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully archived workflow ${workflowId} in ${elapsed}ms`)

      return NextResponse.json({ success: true }, { status: 200 })
    } catch (error: any) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      const elapsed = Date.now() - startTime
      logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/workflows/[id]
 * Update workflow metadata (name, description, folderId)
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized update attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = auth.userId

      const parsed = await parseRequest(updateWorkflowContract, request, context)
      if (!parsed.success) return parsed.response
      const updates = parsed.data.body

      // Fetch the workflow to check ownership/access
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'write',
      })
      const workflowData = authorization.workflow || (await getWorkflowById(workflowId))

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} not found for update`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const canUpdate = authorization.allowed

      if (!canUpdate) {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      if (updates.locked !== undefined && authorization.workspacePermission !== 'admin') {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to lock workflow ${workflowId}`
        )
        return NextResponse.json(
          { error: 'Admin access required to lock workflows' },
          { status: 403 }
        )
      }

      if (updates.forkSyncExcluded !== undefined && authorization.workspacePermission !== 'admin') {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to change sync exclusion for workflow ${workflowId}`
        )
        return NextResponse.json(
          { error: 'Admin access required to exclude workflows from sync' },
          { status: 403 }
        )
      }

      // Policy flags (lock, sync exclusion) don't modify content, so a locked workflow
      // may still have them toggled; everything else requires mutability.
      const hasNonPolicyUpdate = Object.keys(updates).some(
        (key) => key !== 'locked' && key !== 'forkSyncExcluded'
      )
      if (hasNonPolicyUpdate) {
        await assertWorkflowMutable(workflowId)
      }
      if (updates.folderId !== undefined) {
        await assertFolderMutable(updates.folderId)
      }

      if (!workflowData.workspaceId) {
        logger.error(`[${requestId}] Workflow ${workflowId} has no workspaceId`)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }

      const result = await performUpdateWorkflow({
        workflowId,
        userId,
        workspaceId: workflowData.workspaceId,
        currentName: workflowData.name,
        currentFolderId: workflowData.folderId,
        currentLocked: workflowData.locked,
        currentForkSyncExcluded: workflowData.forkSyncExcluded,
        ...updates,
        requestId,
      })

      if (!result.success || !result.workflow) {
        const status =
          result.errorCode === 'not_found'
            ? 404
            : result.errorCode === 'conflict'
              ? 409
              : result.errorCode === 'validation'
                ? 400
                : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully updated workflow ${workflowId} in ${elapsed}ms`, {
        updates,
      })

      return NextResponse.json({ workflow: result.workflow }, { status: 200 })
    } catch (error: any) {
      if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      const elapsed = Date.now() - startTime
      logger.error(`[${requestId}] Error updating workflow ${workflowId} after ${elapsed}ms`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
