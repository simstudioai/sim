import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { createWorkflowContract, workflowListQuerySchema } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { listWorkflowsForUser } from '@/lib/workflows/queries'
import { getUserEntityPermissions, workspaceExists } from '@/lib/workspaces/permissions/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const url = new URL(request.url)
  const query = workflowListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!query.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: query.error.issues },
      { status: 400 }
    )
  }
  const { workspaceId, scope } = query.data

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

    const workflows = await listWorkflowsForUser({ userId, workspaceId, scope })

    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

// POST /api/workflows - Create a new workflow
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized workflow creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = auth.userId

  try {
    const parsed = await parseRequest(createWorkflowContract, req, {})
    if (!parsed.success) return parsed.response
    const {
      id: clientId,
      name: requestedName,
      description,
      workspaceId,
      folderId,
      sortOrder: providedSortOrder,
      deduplicate,
    } = parsed.data.body

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

    await assertFolderMutable(folderId ?? null)

    const result = await performCreateWorkflow({
      id: clientId,
      name: requestedName,
      description,
      workspaceId,
      folderId,
      sortOrder: providedSortOrder,
      deduplicate,
      userId,
      requestId,
    })

    if (!result.success || !result.workflow) {
      const status =
        result.errorCode === 'conflict' ? 409 : result.errorCode === 'validation' ? 400 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const createdWorkflow = result.workflow

    import('@/lib/core/telemetry')
      .then(({ PlatformEvents }) => {
        PlatformEvents.workflowCreated({
          workflowId: createdWorkflow.id,
          name: createdWorkflow.name,
          workspaceId: workspaceId || undefined,
          folderId: folderId || undefined,
        })
      })
      .catch(() => {
        // Silently fail
      })

    logger.info(
      `[${requestId}] Successfully created workflow ${createdWorkflow.id} with default blocks`
    )

    captureServerEvent(
      userId,
      'workflow_created',
      {
        workflow_id: createdWorkflow.id,
        workspace_id: workspaceId ?? '',
        name: createdWorkflow.name,
      },
      {
        groups: workspaceId ? { workspace: workspaceId } : undefined,
        setOnce: { first_workflow_created_at: new Date().toISOString() },
      }
    )

    return NextResponse.json({
      id: createdWorkflow.id,
      name: createdWorkflow.name,
      description: createdWorkflow.description,
      workspaceId: createdWorkflow.workspaceId,
      folderId: createdWorkflow.folderId,
      sortOrder: createdWorkflow.sortOrder,
      createdAt: createdWorkflow.createdAt,
      updatedAt: createdWorkflow.updatedAt,
      startBlockId: createdWorkflow.startBlockId,
      subBlockValues: createdWorkflow.subBlockValues,
    })
  } catch (error) {
    if (error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error(`[${requestId}] Error creating workflow`, error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
})
