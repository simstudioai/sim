import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { workflowVariablesContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Variable } from '@/stores/variables/types'

const logger = createLogger('WorkflowVariablesAPI')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workflowId = (await context.params).id

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized workflow variables update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'write',
      })
      const workflowData = authorization.workflow

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }
      const isAuthorized = authorization.allowed

      if (!isAuthorized) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to update variables for workflow ${workflowId} without permission`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      const parsed = await parseRequest(workflowVariablesContract, req, context)
      if (!parsed.success) return parsed.response
      const { variables } = parsed.data.body
      // Note: prior versions cross-checked that each variable's `workflowId`
      // equalled the path param. The write contract does not carry `workflowId`
      // per variable (the path param is the source of truth), so the check
      // is unreachable and was removed.

      // Variables are already in Record format - use directly
      // The frontend is the source of truth for what variables should exist
      await db
        .update(workflow)
        .set({
          variables,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, workflowId))

      recordAudit({
        workspaceId: workflowData.workspaceId ?? null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: workflowId,
        resourceName: workflowData.name ?? undefined,
        description: `Updated workflow variables`,
        metadata: {
          variableCount: Object.keys(variables).length,
          variableNames: Object.values(variables).map((v) => v.name),
          workflowName: workflowData.name ?? undefined,
        },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Error updating workflow variables`, error)
      return NextResponse.json({ error: 'Failed to update workflow variables' }, { status: 500 })
    }
  }
)

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workflowId = (await params).id

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized workflow variables access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'read',
      })
      const workflowData = authorization.workflow

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }
      const isAuthorized = authorization.allowed

      if (!isAuthorized) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access variables for workflow ${workflowId} without permission`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      // Return variables if they exist. Stamp `workflowId` from the path
      // param on each entry so the global client-side variables store can
      // filter by workflow; the read contract requires this stamped field.
      const persistedVariables =
        (workflowData.variables as Record<string, Record<string, unknown>>) || {}
      const variables: Record<string, Variable> = {}
      for (const [variableId, variable] of Object.entries(persistedVariables)) {
        if (variable && typeof variable === 'object') {
          variables[variableId] = { ...variable, workflowId } as Variable
        }
      }

      // Add cache headers to prevent frequent reloading
      const variableHash = JSON.stringify(variables).length
      const headers = new Headers({
        'Cache-Control': 'max-age=30, stale-while-revalidate=300', // Cache for 30 seconds, stale for 5 min
        ETag: `"variables-${workflowId}-${variableHash}"`,
      })

      return NextResponse.json(
        { data: variables },
        {
          status: 200,
          headers,
        }
      )
    } catch (error) {
      logger.error(`[${requestId}] Workflow variables fetch error`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }
  }
)
