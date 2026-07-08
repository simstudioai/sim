import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteWorkspaceBodySchema, updateWorkspaceContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { captureServerEvent } from '@/lib/posthog/server'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'

const logger = createLogger('WorkspaceByIdAPI')

import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getEffectiveWorkspacePermission,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = id

    // Check if user has any access to this workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    // Get workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    return NextResponse.json({
      workspace: {
        ...workspaceDetails,
        permissions: userPermission,
      },
    })
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceContract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id

    // Check if user has admin permissions to update workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const body = parsed.data.body
      const { name, color, logoUrl, billedAccountUserId, allowPersonalApiKeys } = body

      if (
        name === undefined &&
        color === undefined &&
        logoUrl === undefined &&
        billedAccountUserId === undefined &&
        allowPersonalApiKeys === undefined
      ) {
        return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
      }

      const existingWorkspace = await db
        .select()
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .then((rows) => rows[0])

      if (!existingWorkspace) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = {}

      if (name !== undefined) {
        updateData.name = name
      }

      if (color !== undefined) {
        updateData.color = color
      }

      if (logoUrl !== undefined) {
        updateData.logoUrl = logoUrl
      }

      if (allowPersonalApiKeys !== undefined) {
        updateData.allowPersonalApiKeys = Boolean(allowPersonalApiKeys)
      }

      if (billedAccountUserId !== undefined) {
        if (
          existingWorkspace.organizationId &&
          existingWorkspace.workspaceMode === 'organization'
        ) {
          return NextResponse.json(
            {
              error:
                'Organization workspaces use organization billing and cannot change billed account.',
            },
            { status: 400 }
          )
        }

        if (existingWorkspace.workspaceMode === 'personal') {
          return NextResponse.json(
            {
              error:
                'Personal workspaces are always billed to their owner and cannot change billed account.',
            },
            { status: 400 }
          )
        }

        const candidateId = billedAccountUserId

        const candidatePermission = await getEffectiveWorkspacePermission(
          candidateId,
          existingWorkspace
        )
        if (candidatePermission !== 'admin') {
          return NextResponse.json(
            { error: 'Billed account must be a workspace admin' },
            { status: 400 }
          )
        }

        updateData.billedAccountUserId = candidateId
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 })
      }

      updateData.updatedAt = new Date()

      await db.update(workspace).set(updateData).where(eq(workspace.id, workspaceId))

      const updatedWorkspace = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .then((rows) => rows[0])

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_UPDATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: updatedWorkspace?.name ?? existingWorkspace.name,
        description: `Updated workspace "${updatedWorkspace?.name ?? existingWorkspace.name}"`,
        metadata: {
          changes: {
            ...(name !== undefined && { name: { from: existingWorkspace.name, to: name } }),
            ...(color !== undefined && { color: { from: existingWorkspace.color, to: color } }),
            ...(logoUrl !== undefined && {
              logoUrl: { from: existingWorkspace.logoUrl, to: logoUrl },
            }),
            ...(allowPersonalApiKeys !== undefined && {
              allowPersonalApiKeys: {
                from: existingWorkspace.allowPersonalApiKeys,
                to: allowPersonalApiKeys,
              },
            }),
            ...(billedAccountUserId !== undefined && {
              billedAccountUserId: {
                from: existingWorkspace.billedAccountUserId,
                to: billedAccountUserId,
              },
            }),
          },
        },
        request,
      })

      return NextResponse.json({
        workspace: {
          ...updatedWorkspace,
          permissions: userPermission,
        },
      })
    } catch (error) {
      logger.error('Error updating workspace:', error)
      return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = id
    const rawBody = await request.json().catch(() => ({}))
    const bodyValidation = deleteWorkspaceBodySchema.safeParse(rawBody)
    if (!bodyValidation.success) return validationErrorResponse(bodyValidation.error)

    // Check if user has admin permissions to delete workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      logger.info(`Deleting workspace ${workspaceId} for user ${session.user.id}`)

      const workspaceWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      const workflowIds = workspaceWorkflows.map((entry) => entry.id)

      const archiveResult = await archiveWorkspace(workspaceId, {
        requestId: `workspace-${workspaceId}`,
        provisionFallbackForStrandedMembers: true,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
      })

      if (!archiveResult.archived) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_DELETED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: archiveResult.workspaceName,
        description: `Archived workspace "${archiveResult.workspaceName || workspaceId}"`,
        metadata: {
          affected: {
            workflows: workflowIds.length,
          },
          archived: archiveResult.archived,
          ...(archiveResult.provisionedWorkspaceUserIds?.length && {
            provisionedWorkspaceUserIds: archiveResult.provisionedWorkspaceUserIds,
          }),
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'workspace_deleted',
        { workspace_id: workspaceId, workflow_count: workflowIds.length },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`Error deleting workspace ${workspaceId}:`, error)
      return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // Reuse the PATCH handler implementation for PUT requests
    return PATCH(request, { params })
  }
)
