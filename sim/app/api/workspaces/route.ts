import { and, desc, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workspace, workspaceMember, workflow } from '@/db/schema'

// GET /api/workspaces - Get all workspaces for the current user
export async function GET() {
  const session = await getSession()
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Get all workspaces where the user is a member
  const memberWorkspaces = await db
    .select({
      workspaceId: workspaceMember.workspaceId,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
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
  await ensureWorkflowsHaveWorkspace(session.user.id, memberWorkspaces[0].workspaceId)
  
  // Get full workspace details for all the workspaces
  const workspaces = await Promise.all(
    memberWorkspaces.map(async (memberWorkspace) => {
      const workspaceDetails = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, memberWorkspace.workspaceId))
        .then((rows) => rows[0])
      
      return {
        ...workspaceDetails,
        role: memberWorkspace.role,
      }
    })
  )
  
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
  
  // Create the workspace
  await db.insert(workspace).values({
    id: workspaceId,
    name,
    ownerId: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  
  // Add the user as a member with owner role
  await db.insert(workspaceMember).values({
    id: crypto.randomUUID(),
    workspaceId,
    userId,
    role: 'owner',
    joinedAt: new Date(),
    updatedAt: new Date(),
  })
  
  // Get the created workspace
  const newWorkspace = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .then((rows) => rows[0])
  
  return { ...newWorkspace, role: 'owner' }
}

// Helper function to migrate existing workflows to a workspace
async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  // Find all workflows that have no workspace ID
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(
      eq(workflow.userId, userId),
      isNull(workflow.workspaceId)
    ))
  
  if (orphanedWorkflows.length === 0) {
    return // No orphaned workflows to migrate
  }
  
  console.log(`Migrating ${orphanedWorkflows.length} workflows to workspace ${workspaceId} for user ${userId}`)
  
  // Update each workflow to associate it with the workspace
  for (const { id } of orphanedWorkflows) {
    await db
      .update(workflow)
      .set({
        workspaceId: workspaceId,
        updatedAt: new Date()
      })
      .where(eq(workflow.id, id))
  }
}

// Helper function to ensure all workflows have a workspace
async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  // Find any workflows that still don't have a workspace ID
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(
      eq(workflow.userId, userId),
      isNull(workflow.workspaceId)
    ))
  
  if (orphanedWorkflows.length === 0) {
    return // No orphaned workflows to fix
  }
  
  console.log(`Fixing ${orphanedWorkflows.length} orphaned workflows for user ${userId}`)
  
  // Update each orphaned workflow to associate it with the user's first workspace
  for (const { id } of orphanedWorkflows) {
    await db
      .update(workflow)
      .set({
        workspaceId: defaultWorkspaceId,
        updatedAt: new Date()
      })
      .where(eq(workflow.id, id))
  }
} 