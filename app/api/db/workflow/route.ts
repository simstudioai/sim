import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workflow } from '@/db/schema'

// Schema for workflow data
const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  state: z.record(z.any()),
})

// Handle POST requests (create/update workflow)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const workflowData = WorkflowSchema.parse(body)
    const now = new Date()

    // Upsert the workflow
    await db
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

// Handle DELETE requests (delete workflow)
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { id } = z.object({ id: z.string() }).parse(body)

    // Delete the workflow
    await db.delete(workflow).where(and(eq(workflow.id, id), eq(workflow.userId, session.user.id)))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Workflow deletion error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Workflow deletion failed' }, { status: 500 })
  }
}

// Handle GET requests (fetch workflow)
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      // Fetch all workflows for the user
      const workflows = await db.select().from(workflow).where(eq(workflow.userId, session.user.id))

      return NextResponse.json({ workflows })
    } else {
      // Fetch a specific workflow
      const result = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, id), eq(workflow.userId, session.user.id)))
        .limit(1)

      if (!result.length) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      return NextResponse.json({ workflow: result[0] })
    }
  } catch (error) {
    console.error('Workflow fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch workflow' }, { status: 500 })
  }
}
