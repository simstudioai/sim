import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workspace } from '@/db/schema'

const logger = createLogger('WorkflowAPI')

// Define marketplace data schema
const MarketplaceDataSchema = z
  .object({
    id: z.string(),
    status: z.enum(['owner', 'temp']),
  })
  .nullable()
  .optional()

// Schema for workflow data
const WorkflowStateSchema = z.object({
  blocks: z.record(z.any()),
  edges: z.array(z.any()),
  loops: z.record(z.any()),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z
    .union([z.string(), z.date()])
    .optional()
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  isPublished: z.boolean().optional(),
  marketplaceData: MarketplaceDataSchema,
})

const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  state: WorkflowStateSchema,
  marketplaceData: MarketplaceDataSchema,
  workspaceId: z.string().optional(),
})

const SyncPayloadSchema = z.object({
  workflows: z.record(z.string(), WorkflowSchema),
  workspaceId: z.string().optional(),
})

export async function GET(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // If workspaceId is provided, verify it exists first
    if (workspaceId) {
      const workspaceExists = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .then((rows) => rows.length > 0)

      if (!workspaceExists) {
        logger.warn(
          `[${requestId}] Attempt to fetch workflows for non-existent workspace: ${workspaceId}`
        )
        return NextResponse.json(
          { error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }

      // Migrate any orphaned workflows to this workspace
      await migrateOrphanedWorkflows(userId, workspaceId)
    }

    // Fetch workflows for the user
    let workflows

    if (workspaceId) {
      // Filter by user ID and workspace ID
      workflows = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.userId, userId), eq(workflow.workspaceId, workspaceId)))
    } else {
      // Filter by user ID only, including workflows without workspace IDs
      workflows = await db.select().from(workflow).where(eq(workflow.userId, userId))
    }

    // Return the workflows
    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Helper function to migrate orphaned workflows to a workspace
async function migrateOrphanedWorkflows(userId: string, workspaceId: string) {
  try {
    // Find workflows without workspace IDs for this user
    const orphanedWorkflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

    if (orphanedWorkflows.length === 0) {
      return // No orphaned workflows to migrate
    }

    logger.info(
      `Migrating ${orphanedWorkflows.length} orphaned workflows to workspace ${workspaceId}`
    )

    // Update each workflow to associate it with the provided workspace
    for (const { id } of orphanedWorkflows) {
      await db
        .update(workflow)
        .set({
          workspaceId: workspaceId,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, id))
    }
  } catch (error) {
    logger.error('Error migrating orphaned workflows:', error)
    // Continue execution even if migration fails
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow sync attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const { workflows: clientWorkflows, workspaceId } = SyncPayloadSchema.parse(body)

      // CRITICAL SAFEGUARD: Prevent wiping out existing workflows
      // If client is sending empty workflows object, first check if user has existing workflows
      if (Object.keys(clientWorkflows).length === 0) {
        let existingWorkflows

        if (workspaceId) {
          existingWorkflows = await db
            .select()
            .from(workflow)
            .where(and(eq(workflow.userId, session.user.id), eq(workflow.workspaceId, workspaceId)))
        } else {
          existingWorkflows = await db
            .select()
            .from(workflow)
            .where(eq(workflow.userId, session.user.id))
        }

        // If user has existing workflows, but client sends empty, reject the sync
        if (existingWorkflows.length > 0) {
          logger.warn(
            `[${requestId}] Prevented data loss: Client attempted to sync empty workflows while DB has ${existingWorkflows.length} workflows in workspace ${workspaceId || 'default'}`
          )
          return NextResponse.json(
            {
              error: 'Sync rejected to prevent data loss',
              message: 'Client sent empty workflows, but user has existing workflows in database',
            },
            { status: 409 }
          )
        }
      }

      // Validate that the workspace exists if one is specified
      if (workspaceId) {
        const workspaceExists = await db
          .select({ id: workspace.id })
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
          .then((rows) => rows.length > 0)

        if (!workspaceExists) {
          logger.warn(
            `[${requestId}] Attempt to sync workflows to non-existent workspace: ${workspaceId}`
          )
          return NextResponse.json(
            {
              error: 'Workspace not found',
              code: 'WORKSPACE_NOT_FOUND',
            },
            { status: 404 }
          )
        }
      }

      // Get all workflows for the user from the database
      // If workspaceId is provided, only get workflows for that workspace
      let dbWorkflows

      if (workspaceId) {
        dbWorkflows = await db
          .select()
          .from(workflow)
          .where(and(eq(workflow.userId, session.user.id), eq(workflow.workspaceId, workspaceId)))
      } else {
        dbWorkflows = await db.select().from(workflow).where(eq(workflow.userId, session.user.id))
      }

      const now = new Date()
      const operations: Promise<any>[] = []

      // Create a map of DB workflows for easier lookup
      const dbWorkflowMap = new Map(dbWorkflows.map((w) => [w.id, w]))
      const processedIds = new Set<string>()

      // Process client workflows
      for (const [id, clientWorkflow] of Object.entries(clientWorkflows)) {
        processedIds.add(id)
        const dbWorkflow = dbWorkflowMap.get(id)

        // Handle legacy published workflows migration
        // If client workflow has isPublished but no marketplaceData, create marketplaceData with owner status
        if (clientWorkflow.state.isPublished && !clientWorkflow.marketplaceData) {
          clientWorkflow.marketplaceData = { id: clientWorkflow.id, status: 'owner' }
        }

        // Ensure the workflow has the correct workspaceId
        const effectiveWorkspaceId = clientWorkflow.workspaceId || workspaceId

        if (!dbWorkflow) {
          // New workflow - create
          operations.push(
            db.insert(workflow).values({
              id: clientWorkflow.id,
              userId: session.user.id,
              workspaceId: effectiveWorkspaceId,
              name: clientWorkflow.name,
              description: clientWorkflow.description,
              color: clientWorkflow.color,
              state: clientWorkflow.state,
              marketplaceData: clientWorkflow.marketplaceData || null,
              lastSynced: now,
              createdAt: now,
              updatedAt: now,
            })
          )
        } else {
          // Existing workflow - update if needed
          const needsUpdate =
            JSON.stringify(dbWorkflow.state) !== JSON.stringify(clientWorkflow.state) ||
            dbWorkflow.name !== clientWorkflow.name ||
            dbWorkflow.description !== clientWorkflow.description ||
            dbWorkflow.color !== clientWorkflow.color ||
            dbWorkflow.workspaceId !== effectiveWorkspaceId ||
            JSON.stringify(dbWorkflow.marketplaceData) !==
              JSON.stringify(clientWorkflow.marketplaceData)

          if (needsUpdate) {
            operations.push(
              db
                .update(workflow)
                .set({
                  name: clientWorkflow.name,
                  description: clientWorkflow.description,
                  color: clientWorkflow.color,
                  workspaceId: effectiveWorkspaceId,
                  state: clientWorkflow.state,
                  marketplaceData: clientWorkflow.marketplaceData || null,
                  lastSynced: now,
                  updatedAt: now,
                })
                .where(eq(workflow.id, id))
            )
          }
        }
      }

      // Handle deletions - workflows in DB but not in client
      // Only delete workflows for the current workspace!
      for (const dbWorkflow of dbWorkflows) {
        if (
          !processedIds.has(dbWorkflow.id) &&
          (!workspaceId || dbWorkflow.workspaceId === workspaceId)
        ) {
          operations.push(db.delete(workflow).where(eq(workflow.id, dbWorkflow.id)))
        }
      }

      // Execute all operations in parallel
      await Promise.all(operations)

      return NextResponse.json({ success: true })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid workflow data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Workflow sync error`, error)
    return NextResponse.json({ error: 'Workflow sync failed' }, { status: 500 })
  }
}
