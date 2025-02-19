import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workflow } from '@/db/schema'

// Define the schema for a single workflow
const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  state: z.string(), // JSON stringified workflow state
})

// Define the schema for batch sync
const BatchSyncSchema = z.object({
  workflows: z.array(WorkflowSchema),
  deletedWorkflowIds: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workflows, deletedWorkflowIds } = BatchSyncSchema.parse(body)
    const now = new Date()

    // Process all operations in a single transaction
    await db.transaction(async (tx) => {
      // Handle deletions first
      if (deletedWorkflowIds?.length) {
        await tx
          .delete(workflow)
          .where(
            sql`${workflow.id} IN ${deletedWorkflowIds} AND ${workflow.userId} = ${session.user.id}`
          )
      }

      // Handle updates/inserts
      for (const workflowData of workflows) {
        await tx
          .insert(workflow)
          .values({
            id: workflowData.id,
            userId: session.user.id,
            name: workflowData.name,
            description: workflowData.description,
            state: workflowData.state,
            lastSynced: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [workflow.id],
            set: {
              name: workflowData.name,
              description: workflowData.description,
              state: workflowData.state,
              lastSynced: now,
              updatedAt: now,
            },
            where: eq(workflow.userId, session.user.id),
          })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Batch sync error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Batch sync failed' }, { status: 500 })
  }
}
