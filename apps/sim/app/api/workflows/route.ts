import { db } from '@sim/db'
import { permissions, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, min } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit/log'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserEntityPermissions, workspaceExists } from '@/lib/workspaces/permissions/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowAPI')

const CreateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  color: z.string().optional().default('#3972F6'),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

// GET /api/workflows - Get workflows for user (optionally filtered by workspaceId)
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    if (workspaceId) {
      const wsExists = await workspaceExists(workspaceId)

      if (!wsExists) {
        logger.warn(
          `[${requestId}] Attempt to fetch workflows for non-existent workspace: ${workspaceId}`
        )
        return NextResponse.json(
          { error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }

      const userRole = await verifyWorkspaceMembership(userId, workspaceId)

      if (!userRole) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access workspace ${workspaceId} without membership`
        )
        return NextResponse.json(
          { error: 'Access denied to this workspace', code: 'WORKSPACE_ACCESS_DENIED' },
          { status: 403 }
        )
      }
    }

    let workflows

    const orderByClause = [asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id)]

    if (workspaceId) {
      workflows = await db
        .select()
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
        .orderBy(...orderByClause)
    } else {
      const workspacePermissionRows = await db
        .select({ workspaceId: permissions.entityId })
        .from(permissions)
        .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
      const workspaceIds = workspacePermissionRows.map((row) => row.workspaceId)
      if (workspaceIds.length === 0) {
        return NextResponse.json({ data: [] }, { status: 200 })
      }
      workflows = await db
        .select()
        .from(workflow)
        .where(inArray(workflow.workspaceId, workspaceIds))
        .orderBy(...orderByClause)
    }

    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/workflows - Create a new workflow
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized workflow creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = auth.userId

  try {
    const body = await req.json()
    const {
      name,
      description,
      color,
      workspaceId,
      folderId,
      sortOrder: providedSortOrder,
    } = CreateWorkflowSchema.parse(body)

    if (!workspaceId) {
      logger.warn(`[${requestId}] Workflow creation blocked: missing workspaceId`)
      return NextResponse.json(
        {
          error:
            'workspaceId is required. Personal workflows are deprecated and cannot be created.',
        },
        { status: 400 }
      )
    }

    const workspacePermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

    if (!workspacePermission || workspacePermission === 'read') {
      logger.warn(
        `[${requestId}] User ${userId} attempted to create workflow in workspace ${workspaceId} without write permissions`
      )
      return NextResponse.json(
        { error: 'Write or Admin access required to create workflows in this workspace' },
        { status: 403 }
      )
    }

    const workflowId = crypto.randomUUID()
    const now = new Date()

    logger.info(`[${requestId}] Creating workflow ${workflowId} for user ${userId}`)

    import('@/lib/core/telemetry')
      .then(({ PlatformEvents }) => {
        PlatformEvents.workflowCreated({
          workflowId,
          name,
          workspaceId: workspaceId || undefined,
          folderId: folderId || undefined,
        })
      })
      .catch(() => {
        // Silently fail
      })

    let sortOrder: number
    if (providedSortOrder !== undefined) {
      sortOrder = providedSortOrder
    } else {
      const folderCondition = folderId ? eq(workflow.folderId, folderId) : isNull(workflow.folderId)
      const [minResult] = await db
        .select({ minOrder: min(workflow.sortOrder) })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), folderCondition))
      sortOrder = (minResult?.minOrder ?? 1) - 1
    }

    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: folderId || null,
      sortOrder,
      name,
      description,
      color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    logger.info(`[${requestId}] Successfully created empty workflow ${workflowId}`)

    recordAudit({
      workspaceId,
      actorId: userId,
      action: 'workflow.created',
      resourceType: 'workflow',
      resourceId: workflowId,
      resourceName: name,
      description: `Created workflow "${name}"`,
      metadata: { name },
      request: req,
    })

    return NextResponse.json({
      id: workflowId,
      name,
      description,
      color,
      workspaceId,
      folderId,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow creation data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating workflow`, error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
}
