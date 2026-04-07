import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateId } from '@/lib/core/utils/uuid'
import { captureServerEvent } from '@/lib/posthog/server'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getRandomWorkspaceColor } from '@/lib/workspaces/colors'
import type { WorkspaceScope } from '@/lib/workspaces/utils'

const logger = createLogger('Workspaces')

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  skipDefaultWorkflow: z.boolean().optional().default(false),
})

// Get all workspaces for the current user
export async function GET(request: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const scope = (new URL(request.url).searchParams.get('scope') ?? 'active') as WorkspaceScope
  if (!['active', 'archived', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const userWorkspaces = await db
    .select({
      workspace: workspace,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      scope === 'all'
        ? and(eq(permissions.userId, session.user.id), eq(permissions.entityType, 'workspace'))
        : scope === 'archived'
          ? and(
              eq(permissions.userId, session.user.id),
              eq(permissions.entityType, 'workspace'),
              sql`${workspace.archivedAt} IS NOT NULL`
            )
          : and(
              eq(permissions.userId, session.user.id),
              eq(permissions.entityType, 'workspace'),
              isNull(workspace.archivedAt)
            )
    )
    .orderBy(desc(workspace.createdAt))

  if (scope === 'active' && userWorkspaces.length === 0) {
    const defaultWorkspace = await createDefaultWorkspace(session.user.id, session.user.name)

    await migrateExistingWorkflows(session.user.id, defaultWorkspace.id)

    return NextResponse.json({ workspaces: [defaultWorkspace] })
  }

  if (scope === 'active') {
    await ensureWorkflowsHaveWorkspace(session.user.id, userWorkspaces[0].workspace.id)
  }

  const workspacesWithPermissions = userWorkspaces.map(
    ({ workspace: workspaceDetails, permissionType }) => ({
      ...workspaceDetails,
      role: permissionType === 'admin' ? 'owner' : 'member', // Map admin to owner for compatibility
      permissions: permissionType,
    })
  )

  return NextResponse.json({ workspaces: workspacesWithPermissions })
}

// POST /api/workspaces - Create a new workspace
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name, color, skipDefaultWorkflow } = createWorkspaceSchema.parse(await req.json())

    const newWorkspace = await createWorkspace(session.user.id, name, skipDefaultWorkflow, color)

    captureServerEvent(
      session.user.id,
      'workspace_created',
      { workspace_id: newWorkspace.id, name: newWorkspace.name },
      {
        groups: { workspace: newWorkspace.id },
        setOnce: { first_workspace_created_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId: newWorkspace.id,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.WORKSPACE_CREATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: newWorkspace.id,
      resourceName: newWorkspace.name,
      description: `Created workspace "${newWorkspace.name}"`,
      metadata: { name: newWorkspace.name },
      request: req,
    })

    return NextResponse.json({ workspace: newWorkspace })
  } catch (error) {
    logger.error('Error creating workspace:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}

async function createDefaultWorkspace(userId: string, userName?: string | null) {
  const firstName = userName?.split(' ')[0] || null
  const workspaceName = firstName ? `${firstName}'s Workspace` : 'My Workspace'
  return createWorkspace(userId, workspaceName)
}

async function createWorkspace(
  userId: string,
  name: string,
  skipDefaultWorkflow = false,
  explicitColor?: string
) {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  const color = explicitColor || getRandomWorkspaceColor()

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name,
        color,
        ownerId: userId,
        billedAccountUserId: userId,
        allowPersonalApiKeys: true,
        createdAt: now,
        updatedAt: now,
      })

      await tx.insert(permissions).values({
        id: generateId(),
        entityType: 'workspace' as const,
        entityId: workspaceId,
        userId: userId,
        permissionType: 'admin' as const,
        createdAt: now,
        updatedAt: now,
      })

      if (!skipDefaultWorkflow) {
        await tx.insert(workflow).values({
          id: workflowId,
          userId,
          workspaceId,
          folderId: null,
          name: 'default-agent',
          description: 'Your first workflow - start building here!',
          color: '#3972F6',
          lastSynced: now,
          createdAt: now,
          updatedAt: now,
          isDeployed: false,
          runCount: 0,
          variables: {},
        })

        const { workflowState } = buildDefaultWorkflowArtifacts()
        await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
      }

      logger.info(
        skipDefaultWorkflow
          ? `Created workspace ${workspaceId} for user ${userId}`
          : `Created workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
      )
    })
  } catch (error) {
    logger.error(`Failed to create workspace ${workspaceId}:`, error)
    throw error
  }

  try {
    PlatformEvents.workspaceCreated({
      workspaceId,
      userId,
      name,
    })
  } catch {
    // Telemetry should not fail the operation
  }

  return {
    id: workspaceId,
    name,
    color,
    ownerId: userId,
    billedAccountUserId: userId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
  }
}

async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length === 0) {
    return // No orphaned workflows to migrate
  }

  logger.info(
    `Migrating ${orphanedWorkflows.length} workflows to workspace ${workspaceId} for user ${userId}`
  )

  await db
    .update(workflow)
    .set({
      workspaceId: workspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}

async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  const orphanedWorkflows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length > 0) {
    await db
      .update(workflow)
      .set({
        workspaceId: defaultWorkspaceId,
        updatedAt: new Date(),
      })
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

    logger.info(`Fixed ${orphanedWorkflows.length} orphaned workflows for user ${userId}`)
  }
}
