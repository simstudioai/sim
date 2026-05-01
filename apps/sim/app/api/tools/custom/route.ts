import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteCustomToolContract,
  listCustomToolsContract,
  upsertCustomToolsContract,
} from '@/lib/api/contracts/tools/custom'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { upsertCustomTools } from '@/lib/workflows/custom-tools/operations'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CustomToolsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listCustomToolsContract, request, {})
    if (!parsed.success) return parsed.response

    const userId = authResult.userId
    const { workspaceId, workflowId } = parsed.data.query

    let resolvedWorkspaceId: string | null = workspaceId ?? null
    let resolvedFromWorkflowAuthorization = false

    if (!resolvedWorkspaceId && workflowId) {
      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'read',
      })
      if (!workflowAuthorization.allowed) {
        logger.warn(`[${requestId}] Workflow authorization failed for custom tools`, {
          workflowId,
          userId,
          status: workflowAuthorization.status,
        })
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Access denied' },
          { status: workflowAuthorization.status }
        )
      }

      resolvedWorkspaceId = workflowAuthorization.workflow?.workspaceId ?? null
      resolvedFromWorkflowAuthorization = true
    }

    if (resolvedWorkspaceId && !resolvedFromWorkflowAuthorization) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        resolvedWorkspaceId
      )
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${userId} does not have access to workspace ${resolvedWorkspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const conditions = []

    if (resolvedWorkspaceId) {
      conditions.push(eq(customTools.workspaceId, resolvedWorkspaceId))
    }

    conditions.push(and(isNull(customTools.workspaceId), eq(customTools.userId, userId)))

    const result = await db
      .select()
      .from(customTools)
      .where(or(...conditions))
      .orderBy(desc(customTools.createdAt))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom tools:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom tools' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      upsertCustomToolsContract,
      req,
      {},
      {
        invalidJson: 'throw',
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid custom tools data`, { errors: error.issues })
          return NextResponse.json(
            {
              error: 'Invalid request data',
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const userId = authResult.userId
    const { tools, workspaceId, source } = parsed.data.body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId in request body`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (userPermission !== 'admin' && userPermission !== 'write') {
      logger.warn(
        `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const resultTools = await upsertCustomTools({
      tools,
      workspaceId,
      userId,
      requestId,
    })

    for (const tool of resultTools) {
      captureServerEvent(
        userId,
        'custom_tool_saved',
        { tool_id: tool.id, workspace_id: workspaceId, tool_name: tool.title, source },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_custom_tool_saved_at: new Date().toISOString() },
        }
      )

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: authResult.userName ?? undefined,
        actorEmail: authResult.userEmail ?? undefined,
        action: AuditAction.CUSTOM_TOOL_CREATED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: tool.id,
        resourceName: tool.title,
        description: `Created/updated custom tool "${tool.title}"`,
        metadata: { source },
      })
    }

    return NextResponse.json({ success: true, data: resultTools })
  } catch (error) {
    logger.error(`[${requestId}] Error updating custom tools`, error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to update custom tools'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(
    deleteCustomToolContract,
    request,
    {},
    {
      validationErrorResponse: (error) => {
        logger.warn(`[${requestId}] Missing tool ID for deletion`)
        return NextResponse.json(
          {
            error: 'Tool ID is required',
            details: error.issues,
          },
          { status: 400 }
        )
      },
    }
  )
  if (!parsed.success) return parsed.response

  const { id: toolId, workspaceId, source } = parsed.data.query

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tool deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    const existingTool = await db
      .select()
      .from(customTools)
      .where(eq(customTools.id, toolId))
      .limit(1)

    if (existingTool.length === 0) {
      logger.warn(`[${requestId}] Tool not found: ${toolId}`)
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    const tool = existingTool[0]

    if (tool.workspaceId) {
      if (!workspaceId) {
        logger.warn(`[${requestId}] Missing workspaceId for workspace-scoped tool`)
        return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
      }

      const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      if (tool.workspaceId !== workspaceId) {
        logger.warn(`[${requestId}] Tool ${toolId} does not belong to workspace ${workspaceId}`)
        return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
      }
    } else if (tool.userId !== userId) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to delete tool they don't own: ${toolId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await db.delete(customTools).where(eq(customTools.id, toolId))

    const toolWorkspaceId = tool.workspaceId ?? workspaceId ?? ''
    captureServerEvent(
      userId,
      'custom_tool_deleted',
      { tool_id: toolId, workspace_id: toolWorkspaceId, source },
      toolWorkspaceId ? { groups: { workspace: toolWorkspaceId } } : undefined
    )

    recordAudit({
      workspaceId: tool.workspaceId || undefined,
      actorId: userId,
      actorName: authResult.userName ?? undefined,
      actorEmail: authResult.userEmail ?? undefined,
      action: AuditAction.CUSTOM_TOOL_DELETED,
      resourceType: AuditResourceType.CUSTOM_TOOL,
      resourceId: toolId,
      resourceName: tool.title,
      description: `Deleted custom tool "${tool.title}"`,
      metadata: { source },
    })

    logger.info(`[${requestId}] Deleted tool: ${toolId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom tool:`, error)
    return NextResponse.json({ error: 'Failed to delete custom tool' }, { status: 500 })
  }
})
