import { db } from '@sim/db'
import { permissions, workflow, workflowLogWebhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('WorkflowLogWebhookAPI')

const CreateWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  includeFinalOutput: z.boolean().optional().default(false),
  includeTraceSpans: z.boolean().optional().default(false),
  includeRateLimits: z.boolean().optional().default(false),
  includeUsageData: z.boolean().optional().default(false),
  levelFilter: z
    .array(z.enum(['info', 'error']))
    .optional()
    .default(['info', 'error']),
  triggerFilter: z
    .array(z.enum(['api', 'webhook', 'schedule', 'manual', 'chat']))
    .optional()
    .default(['api', 'webhook', 'schedule', 'manual', 'chat']),
  active: z.boolean().optional().default(true),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params
    const userId = session.user.id

    const hasAccess = await db
      .select({ id: workflow.id })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (hasAccess.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const webhooks = await db
      .select({
        id: workflowLogWebhook.id,
        url: workflowLogWebhook.url,
        includeFinalOutput: workflowLogWebhook.includeFinalOutput,
        includeTraceSpans: workflowLogWebhook.includeTraceSpans,
        includeRateLimits: workflowLogWebhook.includeRateLimits,
        includeUsageData: workflowLogWebhook.includeUsageData,
        levelFilter: workflowLogWebhook.levelFilter,
        triggerFilter: workflowLogWebhook.triggerFilter,
        active: workflowLogWebhook.active,
        createdAt: workflowLogWebhook.createdAt,
        updatedAt: workflowLogWebhook.updatedAt,
      })
      .from(workflowLogWebhook)
      .where(eq(workflowLogWebhook.workflowId, workflowId))

    return NextResponse.json({ data: webhooks })
  } catch (error) {
    logger.error('Error fetching log webhooks', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params
    const userId = session.user.id

    const hasAccess = await db
      .select({ id: workflow.id })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (hasAccess.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const body = await request.json()
    const validationResult = CreateWebhookSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const data = validationResult.data

    // Check for duplicate URL
    const existingWebhook = await db
      .select({ id: workflowLogWebhook.id })
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.workflowId, workflowId), eq(workflowLogWebhook.url, data.url))
      )
      .limit(1)

    if (existingWebhook.length > 0) {
      return NextResponse.json(
        { error: 'A webhook with this URL already exists for this workflow' },
        { status: 409 }
      )
    }

    let encryptedSecret: string | null = null

    if (data.secret) {
      const { encrypted } = await encryptSecret(data.secret)
      encryptedSecret = encrypted
    }

    const [webhook] = await db
      .insert(workflowLogWebhook)
      .values({
        id: uuidv4(),
        workflowId,
        url: data.url,
        secret: encryptedSecret,
        includeFinalOutput: data.includeFinalOutput,
        includeTraceSpans: data.includeTraceSpans,
        includeRateLimits: data.includeRateLimits,
        includeUsageData: data.includeUsageData,
        levelFilter: data.levelFilter,
        triggerFilter: data.triggerFilter,
        active: data.active,
      })
      .returning()

    logger.info('Created log webhook', {
      workflowId,
      webhookId: webhook.id,
      url: data.url,
    })

    return NextResponse.json({
      data: {
        id: webhook.id,
        url: webhook.url,
        includeFinalOutput: webhook.includeFinalOutput,
        includeTraceSpans: webhook.includeTraceSpans,
        includeRateLimits: webhook.includeRateLimits,
        includeUsageData: webhook.includeUsageData,
        levelFilter: webhook.levelFilter,
        triggerFilter: webhook.triggerFilter,
        active: webhook.active,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      },
    })
  } catch (error) {
    logger.error('Error creating log webhook', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params
    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('webhookId')

    if (!webhookId) {
      return NextResponse.json({ error: 'webhookId is required' }, { status: 400 })
    }

    const hasAccess = await db
      .select({ id: workflow.id })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (hasAccess.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const deleted = await db
      .delete(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.id, webhookId), eq(workflowLogWebhook.workflowId, workflowId))
      )
      .returning({ id: workflowLogWebhook.id })

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    logger.info('Deleted log webhook', {
      workflowId,
      webhookId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting log webhook', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
