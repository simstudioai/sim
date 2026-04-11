import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { captureServerEvent } from '@/lib/posthog/server'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'

const logger = createLogger('WorkspaceByIdAPI')

import { db } from '@sim/db'
import { permissions, templates, workspace } from '@sim/db/schema'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const patchWorkspaceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  billedAccountUserId: z.string().optional(),
  allowPersonalApiKeys: z.boolean().optional(),
})

const deleteWorkspaceSchema = z.object({
  deleteTemplates: z.boolean().default(false),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id
  const url = new URL(request.url)
  const checkTemplates = url.searchParams.get('check-templates') === 'true'

  // Check if user has any access to this workspace
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!userPermission) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
  }

  // If checking for published templates before deletion
  if (checkTemplates) {
    try {
      // Get all workflows in this workspace
      const workspaceWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      if (workspaceWorkflows.length === 0) {
        return NextResponse.json({ hasPublishedTemplates: false, publishedTemplates: [] })
      }

      const workflowIds = workspaceWorkflows.map((w) => w.id)

      // Check for published templates that reference these workflows
      const publishedTemplates = await db
        .select({
          id: templates.id,
          name: templates.name,
          workflowId: templates.workflowId,
        })
        .from(templates)
        .where(inArray(templates.workflowId, workflowIds))

      return NextResponse.json({
        hasPublishedTemplates: publishedTemplates.length > 0,
        publishedTemplates,
        count: publishedTemplates.length,
      })
    } catch (error) {
      logger.error(`Error checking published templates for workspace ${workspaceId}:`, error)
      return NextResponse.json({ error: 'Failed to check published templates' }, { status: 500 })
    }
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has admin permissions to update workspace
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const body = patchWorkspaceSchema.parse(await request.json())
    const { name, color, billedAccountUserId, allowPersonalApiKeys } = body

    if (
      name === undefined &&
      color === undefined &&
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

    if (allowPersonalApiKeys !== undefined) {
      updateData.allowPersonalApiKeys = Boolean(allowPersonalApiKeys)
    }

    if (billedAccountUserId !== undefined) {
      const candidateId = billedAccountUserId

      const isOwner = candidateId === existingWorkspace.ownerId

      let hasAdminAccess = isOwner

      if (!hasAdminAccess) {
        const adminPermission = await db
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId),
              eq(permissions.userId, candidateId),
              eq(permissions.permissionType, 'admin')
            )
          )
          .limit(1)

        hasAdminAccess = adminPermission.length > 0
      }

      if (!hasAdminAccess) {
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id
  const body = deleteWorkspaceSchema.parse(await request.json().catch(() => ({})))
  const { deleteTemplates } = body // User's choice: false = keep templates (recommended), true = delete templates

  // Check if user has admin permissions to delete workspace
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    logger.info(
      `Deleting workspace ${workspaceId} for user ${session.user.id}, deleteTemplates: ${deleteTemplates}`
    )

    // Fetch workspace name before deletion for audit logging
    const [workspaceRecord] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
      .limit(1)

    const workspaceWorkflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.workspaceId, workspaceId))

    const workflowIds = workspaceWorkflows.map((entry) => entry.id)

    if (workflowIds.length > 0) {
      if (deleteTemplates) {
        await db.delete(templates).where(inArray(templates.workflowId, workflowIds))
      } else {
        await db
          .update(templates)
          .set({ workflowId: null })
          .where(inArray(templates.workflowId, workflowIds))
      }
    }

    const archiveResult = await archiveWorkspace(workspaceId, {
      requestId: `workspace-${workspaceId}`,
    })

    if (!archiveResult.archived && !workspaceRecord) {
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
      resourceName: workspaceRecord?.name,
      description: `Archived workspace "${workspaceRecord?.name || workspaceId}"`,
      metadata: {
        affected: {
          workflows: workflowIds.length,
        },
        archived: archiveResult.archived,
        deleteTemplates,
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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Reuse the PATCH handler implementation for PUT requests
  return PATCH(request, { params })
}
