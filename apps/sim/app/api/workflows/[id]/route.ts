import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthType, checkHybridAuth, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performDeleteWorkflow } from '@/lib/workflows/orchestration'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getWorkflowById } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowByIdAPI')

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow by ID
 * Uses hybrid approach: try normalized tables first, fallback to JSON blob
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await params

    try {
      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success) {
        logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const isInternalCall = auth.authType === AuthType.INTERNAL_JWT
      const userId = auth.userId || null

      let workflowData = await getWorkflowById(workflowId)

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      if (auth.apiKeyType === 'workspace' && auth.workspaceId !== workflowData.workspaceId) {
        return NextResponse.json(
          { error: 'API key is not authorized for this workspace' },
          { status: 403 }
        )
      }

      if (isInternalCall && !userId) {
        // Internal system calls (e.g. workflow-in-workflow executor) may not carry a userId.
        // These are already authenticated via internal JWT; allow read access.
        logger.info(`[${requestId}] Internal API call for workflow ${workflowId}`)
      } else if (!userId) {
        logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      } else {
        const authorization = await authorizeWorkflowByWorkspacePermission({
          workflowId,
          userId,
          action: 'read',
        })
        if (!authorization.workflow) {
          logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
          return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
        }

        workflowData = authorization.workflow
        if (!authorization.allowed) {
          logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
          return NextResponse.json(
            { error: authorization.message || 'Access denied' },
            { status: authorization.status }
          )
        }
      }

      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

      if (normalizedData) {
        const finalWorkflowData = {
          ...workflowData,
          state: {
            blocks: normalizedData.blocks,
            edges: normalizedData.edges,
            loops: normalizedData.loops,
            parallels: normalizedData.parallels,
            lastSaved: Date.now(),
            isDeployed: workflowData.isDeployed || false,
            deployedAt: workflowData.deployedAt,
            metadata: {
              name: workflowData.name,
              description: workflowData.description,
            },
          },
          variables: workflowData.variables || {},
        }

        logger.info(`[${requestId}] Loaded workflow ${workflowId} from normalized tables`)
        const elapsed = Date.now() - startTime
        logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

        return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
      }

      const emptyWorkflowData = {
        ...workflowData,
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed || false,
          deployedAt: workflowData.deployedAt,
          metadata: {
            name: workflowData.name,
            description: workflowData.description,
          },
        },
        variables: workflowData.variables || {},
      }

      return NextResponse.json({ data: emptyWorkflowData }, { status: 200 })
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      logger.error(`[${requestId}] Error fetching workflow ${workflowId} after ${elapsed}ms`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

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
        action: 'admin',
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

      const { searchParams } = new URL(request.url)
      const checkTemplates = searchParams.get('check-templates') === 'true'
      const deleteTemplatesParam = searchParams.get('deleteTemplates')

      if (checkTemplates) {
        const { templates } = await import('@sim/db/schema')
        const publishedTemplates = await db
          .select({
            id: templates.id,
            name: templates.name,
            views: templates.views,
            stars: templates.stars,
            status: templates.status,
          })
          .from(templates)
          .where(eq(templates.workflowId, workflowId))

        return NextResponse.json({
          hasPublishedTemplates: publishedTemplates.length > 0,
          count: publishedTemplates.length,
          publishedTemplates: publishedTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            views: t.views,
            stars: t.stars,
          })),
        })
      }

      const result = await performDeleteWorkflow({
        workflowId,
        userId,
        requestId,
        templateAction: deleteTemplatesParam === 'delete' ? 'delete' : 'orphan',
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
      const elapsed = Date.now() - startTime
      logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/workflows/[id]
 * Update workflow metadata (name, description, color, folderId)
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized update attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = auth.userId

      const body = await request.json()
      const updates = UpdateWorkflowSchema.parse(body)

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

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.description !== undefined) updateData.description = updates.description
      if (updates.color !== undefined) updateData.color = updates.color
      if (updates.folderId !== undefined) updateData.folderId = updates.folderId
      if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder

      if (updates.name !== undefined || updates.folderId !== undefined) {
        const targetName = updates.name ?? workflowData.name
        const targetFolderId =
          updates.folderId !== undefined ? updates.folderId : workflowData.folderId

        if (!workflowData.workspaceId) {
          logger.error(`[${requestId}] Workflow ${workflowId} has no workspaceId`)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }

        const conditions = [
          eq(workflow.workspaceId, workflowData.workspaceId),
          isNull(workflow.archivedAt),
          eq(workflow.name, targetName),
          ne(workflow.id, workflowId),
        ]

        if (targetFolderId) {
          conditions.push(eq(workflow.folderId, targetFolderId))
        } else {
          conditions.push(isNull(workflow.folderId))
        }

        const [duplicate] = await db
          .select({ id: workflow.id })
          .from(workflow)
          .where(and(...conditions))
          .limit(1)

        if (duplicate) {
          logger.warn(
            `[${requestId}] Duplicate workflow name "${targetName}" in folder ${targetFolderId ?? 'root'}`
          )
          return NextResponse.json(
            { error: `A workflow named "${targetName}" already exists in this folder` },
            { status: 409 }
          )
        }
      }

      // Update the workflow
      const [updatedWorkflow] = await db
        .update(workflow)
        .set(updateData)
        .where(eq(workflow.id, workflowId))
        .returning()

      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully updated workflow ${workflowId} in ${elapsed}ms`, {
        updates: updateData,
      })

      return NextResponse.json({ workflow: updatedWorkflow }, { status: 200 })
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      if (error instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid workflow update data for ${workflowId}`, {
          errors: error.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }

      logger.error(`[${requestId}] Error updating workflow ${workflowId} after ${elapsed}ms`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
