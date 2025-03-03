import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workflow } from '@/db/schema'

// Schema for workflow data
const WorkflowStateSchema = z.object({
  blocks: z.record(z.any()),
  edges: z.array(z.any()),
  loops: z.record(z.any()),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.date().optional(),
})

const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  state: WorkflowStateSchema,
})

const SyncPayloadSchema = z.object({
  workflows: z.record(z.string(), WorkflowSchema),
})

export async function GET(request: Request) {
  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch all workflows for the user
    const workflows = await db.select().from(workflow).where(eq(workflow.userId, userId))

    // Return the workflows
    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    console.error('Workflow fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflows: clientWorkflows } = SyncPayloadSchema.parse(body)

    // Get all workflows for the user from the database
    const dbWorkflows = await db.select().from(workflow).where(eq(workflow.userId, session.user.id))

    const now = new Date()
    const operations: Promise<any>[] = []

    // Create a map of DB workflows for easier lookup
    const dbWorkflowMap = new Map(dbWorkflows.map((w) => [w.id, w]))
    const processedIds = new Set<string>()

    // Process client workflows
    for (const [id, clientWorkflow] of Object.entries(clientWorkflows)) {
      processedIds.add(id)
      const dbWorkflow = dbWorkflowMap.get(id)

      if (!dbWorkflow) {
        // New workflow - create
        operations.push(
          db.insert(workflow).values({
            id: clientWorkflow.id,
            userId: session.user.id,
            name: clientWorkflow.name,
            description: clientWorkflow.description,
            color: clientWorkflow.color,
            state: clientWorkflow.state,
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
          dbWorkflow.color !== clientWorkflow.color

        if (needsUpdate) {
          operations.push(
            db
              .update(workflow)
              .set({
                name: clientWorkflow.name,
                description: clientWorkflow.description,
                color: clientWorkflow.color,
                state: clientWorkflow.state,
                lastSynced: now,
                updatedAt: now,
              })
              .where(eq(workflow.id, id))
          )
        }
      }
    }

    // Handle deletions - workflows in DB but not in client
    for (const dbWorkflow of dbWorkflows) {
      if (!processedIds.has(dbWorkflow.id)) {
        operations.push(db.delete(workflow).where(eq(workflow.id, dbWorkflow.id)))
      }
    }

    // Execute all operations in parallel
    await Promise.all(operations)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Workflow sync error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Workflow sync failed' }, { status: 500 })
  }
}
