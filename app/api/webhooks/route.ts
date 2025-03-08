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

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    // Create where condition
    const whereCondition = workflowId
      ? and(eq(workflow.userId, session.user.id), eq(webhook.workflowId, workflowId))
      : eq(workflow.userId, session.user.id)

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
      .where(whereCondition)

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
    const { workflowId, path, provider, providerConfig } = body

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

    // If a webhook with the same path exists but belongs to a different workflow, return an error
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId !== workflowId) {
      return NextResponse.json(
        { error: 'Webhook path already exists. Please use a different path.', code: 'PATH_EXISTS' },
        { status: 409 }
      )
    }

    // If a webhook with the same path and workflowId exists, update it
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId === workflowId) {
      const updatedWebhook = await db
        .update(webhook)
        .set({
          provider,
          providerConfig,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, existingWebhooks[0].id))
        .returning()

      return NextResponse.json({ webhook: updatedWebhook[0] }, { status: 200 })
    }

    // Create a new webhook
    const newWebhook = await db
      .insert(webhook)
      .values({
        id: nanoid(),
        workflowId,
        path,
        provider,
        providerConfig,
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
