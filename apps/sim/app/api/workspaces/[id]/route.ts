import { workflow } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkspaceByIdAPI')

import { db } from '@sim/db'
import { knowledgeBase, permissions, templates, workspace } from '@sim/db/schema'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

const patchWorkspaceSchema = z.object({
  name: z.string().trim().min(1).optional(),
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
    .where(eq(workspace.id, workspaceId))
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
    const { name, billedAccountUserId, allowPersonalApiKeys } = body

    if (
      name === undefined &&
      billedAccountUserId === undefined &&
      allowPersonalApiKeys === undefined
    ) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const existingWorkspace = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .then((rows) => rows[0])

    if (!existingWorkspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}

    if (name !== undefined) {
      updateData.name = name
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

    // Delete workspace and all related data in a transaction
    await db.transaction(async (tx) => {
      // Get all workflows in this workspace before deletion
      const workspaceWorkflows = await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      if (workspaceWorkflows.length > 0) {
        const workflowIds = workspaceWorkflows.map((w) => w.id)

        // Handle templates based on user choice
        if (deleteTemplates) {
          // Delete published templates that reference these workflows
          await tx.delete(templates).where(inArray(templates.workflowId, workflowIds))
          logger.info(`Deleted templates for workflows in workspace ${workspaceId}`)
        } else {
          // Set workflowId to null for templates to create "orphaned" templates
          // This allows templates to remain in marketplace but without source workflows
          await tx
            .update(templates)
            .set({ workflowId: null })
            .where(inArray(templates.workflowId, workflowIds))
          logger.info(
            `Updated templates to orphaned status for workflows in workspace ${workspaceId}`
          )
        }
      }

      // Delete all workflows in the workspace - database cascade will handle all workflow-related data
      // The database cascade will handle deleting related workflow_blocks, workflow_edges, workflow_subflows,
      // workflow_logs, workflow_execution_snapshots, workflow_execution_logs, workflow_execution_trace_spans,
      // workflow_schedule, webhook, marketplace, chat, and memory records
      await tx.delete(workflow).where(eq(workflow.workspaceId, workspaceId))

      // Clear workspace ID from knowledge bases instead of deleting them
      // This allows knowledge bases to become "unassigned" rather than being deleted
      await tx
        .update(knowledgeBase)
        .set({ workspaceId: null, updatedAt: new Date() })
        .where(eq(knowledgeBase.workspaceId, workspaceId))

      // Delete all permissions associated with this workspace
      await tx
        .delete(permissions)
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

      // Delete the workspace itself
      await tx.delete(workspace).where(eq(workspace.id, workspaceId))

      logger.info(`Successfully deleted workspace ${workspaceId} and all related data`)
    })

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
