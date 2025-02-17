import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workflow } from '@/db/schema'

// Define the schema for incoming data
const WorkflowSyncSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  state: z.string(), // JSON stringified workflow state
})

export async function POST(request: Request) {
  try {
    // Get the authenticated user
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate the request body
    const body = await request.json()
    const { id, name, description, state } = WorkflowSyncSchema.parse(body)

    // Get the current timestamp
    const now = new Date()

    // Upsert the workflow
    await db
      .insert(workflow)
      .values({
        id,
        userId: session.user.id,
        name,
        description,
        state,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [workflow.id],
        set: {
          name,
          description,
          state,
          lastSynced: now,
          updatedAt: now,
        },
        where: eq(workflow.userId, session.user.id), // Only update if the workflow belongs to the user
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Workflow sync error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
