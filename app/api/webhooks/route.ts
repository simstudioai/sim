import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

export const dynamic = 'force-dynamic'

// Get all webhooks for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(workflow.userId, session.user.id))

    return NextResponse.json({ webhooks }, { status: 200 })
  } catch (error) {
    console.error('Error fetching webhooks:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create a new webhook
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workflowId, path, secret, provider } = body

    // Validate input
    if (!workflowId || !path) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if the workflow belongs to the user
    const workflows = await db
      .select()
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), eq(workflow.userId, session.user.id)))
      .limit(1)

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if a webhook with the same path already exists
    const existingWebhooks = await db.select().from(webhook).where(eq(webhook.path, path)).limit(1)

    if (existingWebhooks.length > 0) {
      return NextResponse.json({ error: 'Webhook path already exists' }, { status: 409 })
    }

    // Create the webhook
    const newWebhook = await db
      .insert(webhook)
      .values({
        id: nanoid(),
        workflowId,
        path,
        secret,
        provider,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    return NextResponse.json({ webhook: newWebhook[0] }, { status: 201 })
  } catch (error) {
    console.error('Error creating webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
