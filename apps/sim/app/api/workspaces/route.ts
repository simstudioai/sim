import crypto from 'crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { permissions, workflow, workflowBlocks, workspace, workspaceMember } from '@/db/schema'

// Get all workspaces for the current user
export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all workspaces where the user is a member with a single join query
  const memberWorkspaces = await db
    .select({
      workspace: workspace,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(eq(workspaceMember.userId, session.user.id))
    .orderBy(desc(workspaceMember.joinedAt))

  if (memberWorkspaces.length === 0) {
    // Create a default workspace for the user
    const defaultWorkspace = await createDefaultWorkspace(session.user.id, session.user.name)

    // Migrate existing workflows to the default workspace
    await migrateExistingWorkflows(session.user.id, defaultWorkspace.id)

    return NextResponse.json({ workspaces: [defaultWorkspace] })
  }

  // If user has workspaces but might have orphaned workflows, migrate them
  await ensureWorkflowsHaveWorkspace(session.user.id, memberWorkspaces[0].workspace.id)

  // Format the response
  const workspaces = memberWorkspaces.map(({ workspace: workspaceDetails, role }) => ({
    ...workspaceDetails,
    role,
  }))

  return NextResponse.json({ workspaces })
}

// POST /api/workspaces - Create a new workspace
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name } = await req.json()

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const newWorkspace = await createWorkspace(session.user.id, name)

    return NextResponse.json({ workspace: newWorkspace })
  } catch (error) {
    console.error('Error creating workspace:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}

// Helper function to create a default workspace
async function createDefaultWorkspace(userId: string, userName?: string | null) {
  const workspaceName = userName ? `${userName}'s Workspace` : 'My Workspace'
  return createWorkspace(userId, workspaceName)
}

// Helper function to create a workspace
async function createWorkspace(userId: string, name: string) {
  const workspaceId = crypto.randomUUID()
  const workflowId = crypto.randomUUID()
  const now = new Date()

  // Create the workspace and initial workflow in a transaction
  try {
    await db.transaction(async (tx) => {
      // Create the workspace
      await tx.insert(workspace).values({
        id: workspaceId,
        name,
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
      })

      // Add the user as a member with owner role
      await tx.insert(workspaceMember).values({
        id: crypto.randomUUID(),
        workspaceId,
        userId,
        role: 'owner',
        joinedAt: now,
        updatedAt: now,
      })

      // Create "Workflow 1" for the workspace with start block
      const starterId = crypto.randomUUID()
      const initialState = {
        blocks: {
          [starterId]: {
            id: starterId,
            type: 'starter',
            name: 'Start',
            position: { x: 100, y: 100 },
            subBlocks: {
              startWorkflow: {
                id: 'startWorkflow',
                type: 'dropdown',
                value: 'manual',
              },
              webhookPath: {
                id: 'webhookPath',
                type: 'short-input',
                value: '',
              },
              webhookSecret: {
                id: 'webhookSecret',
                type: 'short-input',
                value: '',
              },
              scheduleType: {
                id: 'scheduleType',
                type: 'dropdown',
                value: 'daily',
              },
              minutesInterval: {
                id: 'minutesInterval',
                type: 'short-input',
                value: '',
              },
              minutesStartingAt: {
                id: 'minutesStartingAt',
                type: 'short-input',
                value: '',
              },
            },
            outputs: {
              response: { type: { input: 'any' } },
            },
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            height: 95,
          },
        },
        edges: [],
        subflows: {},
        variables: {},
        metadata: {
          version: '1.0.0',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      }

      // Create the workflow
      await tx.insert(workflow).values({
        id: workflowId,
        userId,
        workspaceId,
        folderId: null,
        name: 'Workflow 1',
        description: 'Your first workflow - start building here!',
        state: initialState,
        color: '#3972F6',
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        collaborators: [],
        runCount: 0,
        variables: {},
        isPublished: false,
        marketplaceData: null,
      })

      // Insert the start block into workflow_blocks table
      await tx.insert(workflowBlocks).values({
        id: starterId,
        workflowId: workflowId,
        type: 'starter',
        name: 'Start',
        positionX: '100',
        positionY: '100',
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: '95',
        subBlocks: {
          startWorkflow: {
            id: 'startWorkflow',
            type: 'dropdown',
            value: 'manual',
          },
          webhookPath: {
            id: 'webhookPath',
            type: 'short-input',
            value: '',
          },
          webhookSecret: {
            id: 'webhookSecret',
            type: 'short-input',
            value: '',
          },
          scheduleType: {
            id: 'scheduleType',
            type: 'dropdown',
            value: 'daily',
          },
          minutesInterval: {
            id: 'minutesInterval',
            type: 'short-input',
            value: '',
          },
          minutesStartingAt: {
            id: 'minutesStartingAt',
            type: 'short-input',
            value: '',
          },
        },
        outputs: {
          response: {
            type: {
              input: 'any',
            },
          },
        },
        createdAt: now,
        updatedAt: now,
      })

      console.log(
        `✅ Created workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
      )
    })
  } catch (error) {
    console.error(`❌ Failed to create workspace ${workspaceId} with initial workflow:`, error)
    throw error
  }

  // Create default permissions for the workspace owner
  await db.insert(permissions).values({
    id: crypto.randomUUID(),
    entityType: 'workspace' as const,
    entityId: workspaceId,
    userId: userId,
    permissionType: 'admin' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Return the workspace data directly instead of querying again
  return {
    id: workspaceId,
    name,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
  }
}

// Helper function to migrate existing workflows to a workspace
async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  // Find all workflows that have no workspace ID
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length === 0) {
    return // No orphaned workflows to migrate
  }

  console.log(
    `Migrating ${orphanedWorkflows.length} workflows to workspace ${workspaceId} for user ${userId}`
  )

  // Bulk update all orphaned workflows at once
  await db
    .update(workflow)
    .set({
      workspaceId: workspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}

// Helper function to ensure all workflows have a workspace
async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  // First check if there are any orphaned workflows
  const orphanedWorkflows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length > 0) {
    // Directly update any workflows that don't have a workspace ID in a single query
    await db
      .update(workflow)
      .set({
        workspaceId: defaultWorkspaceId,
        updatedAt: new Date(),
      })
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

    console.log(`Fixed ${orphanedWorkflows.length} orphaned workflows for user ${userId}`)
  }
}
