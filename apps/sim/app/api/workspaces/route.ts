import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('Workspaces')

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  skipDefaultWorkflow: z.boolean().optional().default(false),
})

// Get all workspaces for the current user
export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userWorkspaces = await db
    .select({
      workspace: workspace,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.userId, session.user.id), eq(permissions.entityType, 'workspace')))
    .orderBy(desc(workspace.createdAt))

  if (userWorkspaces.length === 0) {
    const defaultWorkspace = await createDefaultWorkspace(session.user.id, session.user.name)

    await migrateExistingWorkflows(session.user.id, defaultWorkspace.id)

    return NextResponse.json({ workspaces: [defaultWorkspace] })
  }

  await ensureWorkflowsHaveWorkspace(session.user.id, userWorkspaces[0].workspace.id)

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
    const { name, skipDefaultWorkflow } = createWorkspaceSchema.parse(await req.json())

    const newWorkspace = await createWorkspace(session.user.id, name, skipDefaultWorkflow)

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

async function createWorkspace(userId: string, name: string, skipDefaultWorkflow = false) {
  const workspaceId = crypto.randomUUID()
  const workflowId = crypto.randomUUID()
  const now = new Date()

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name,
        ownerId: userId,
        billedAccountUserId: userId,
        allowPersonalApiKeys: true,
        createdAt: now,
        updatedAt: now,
      })

      await tx.insert(permissions).values({
        id: crypto.randomUUID(),
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
      }

      logger.info(
        skipDefaultWorkflow
          ? `Created workspace ${workspaceId} for user ${userId}`
          : `Created workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
      )
    })

    if (!skipDefaultWorkflow) {
      const { workflowState } = buildDefaultWorkflowArtifacts()
      const seedResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)

      if (!seedResult.success) {
        throw new Error(seedResult.error || 'Failed to seed default workflow state')
      }
    }
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
