import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

const logger = createLogger('WebhooksAPI')

export const dynamic = 'force-dynamic'

// Get all webhooks for the current user
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhooks access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    logger.debug(`[${requestId}] Fetching webhooks for user ${session.user.id}`, {
      filteredByWorkflow: !!workflowId,
    })

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

    logger.info(`[${requestId}] Retrieved ${webhooks.length} webhooks for user ${session.user.id}`)
    return NextResponse.json({ webhooks }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhooks`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create a new webhook
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workflowId, path, provider, providerConfig } = body

    // Validate input
    if (!workflowId || !path) {
      logger.warn(`[${requestId}] Missing required fields for webhook creation`, {
        hasWorkflowId: !!workflowId,
        hasPath: !!path,
      })
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    logger.debug(`[${requestId}] Creating webhook for workflow ${workflowId}`, {
      path,
      provider: provider || 'generic',
    })

    // Check if the workflow belongs to the user
    const workflows = await db
      .select()
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), eq(workflow.userId, session.user.id)))
      .limit(1)

    if (workflows.length === 0) {
      logger.warn(`[${requestId}] Workflow not found or not owned by user: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if a webhook with the same path already exists
    const existingWebhooks = await db.select().from(webhook).where(eq(webhook.path, path)).limit(1)

    // If a webhook with the same path exists but belongs to a different workflow, return an error
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId !== workflowId) {
      logger.warn(`[${requestId}] Webhook path conflict: ${path}`, {
        existingWorkflowId: existingWebhooks[0].workflowId,
        requestedWorkflowId: workflowId,
      })
      return NextResponse.json(
        {
          error: 'Webhook path already exists. Please use a different path.',
          code: 'PATH_EXISTS',
        },
        { status: 409 }
      )
    }

    // If a webhook with the same path and workflowId exists, update it
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId === workflowId) {
      logger.info(`[${requestId}] Updating existing webhook for path: ${path}`)

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
    const webhookId = nanoid()
    logger.info(`[${requestId}] Creating new webhook with ID: ${webhookId}`, {
      path,
      workflowId,
      provider: provider || 'generic',
    })

    const newWebhook = await db
      .insert(webhook)
      .values({
        id: webhookId,
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
    logger.error(`[${requestId}] Error creating webhook`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
