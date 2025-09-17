import { db } from '@sim/db'
import { permissions, workflow, workflowLogWebhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('WorkflowLogWebhookUpdate')

type WebhookUpdatePayload = Pick<
  typeof workflowLogWebhook.$inferInsert,
  | 'url'
  | 'includeFinalOutput'
  | 'includeTraceSpans'
  | 'includeRateLimits'
  | 'includeUsageData'
  | 'levelFilter'
  | 'triggerFilter'
  | 'secret'
  | 'updatedAt'
>

const UpdateWebhookSchema = z.object({
  url: z.string().url('Invalid webhook URL'),
  secret: z.string().optional(),
  includeFinalOutput: z.boolean(),
  includeTraceSpans: z.boolean(),
  includeRateLimits: z.boolean(),
  includeUsageData: z.boolean(),
  levelFilter: z.array(z.enum(['info', 'error'])),
  triggerFilter: z.array(z.enum(['api', 'webhook', 'schedule', 'manual', 'chat'])),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhookId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId, webhookId } = await params
    const userId = session.user.id

    // Check if user has access to the workflow
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

    // Check if webhook exists and belongs to this workflow
    const existingWebhook = await db
      .select()
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.id, webhookId), eq(workflowLogWebhook.workflowId, workflowId))
      )
      .limit(1)

    if (existingWebhook.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const body = await request.json()
    const validationResult = UpdateWebhookSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const data = validationResult.data

    // Check for duplicate URL (excluding current webhook)
    const duplicateWebhook = await db
      .select({ id: workflowLogWebhook.id })
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.workflowId, workflowId), eq(workflowLogWebhook.url, data.url))
      )
      .limit(1)

    if (duplicateWebhook.length > 0 && duplicateWebhook[0].id !== webhookId) {
      return NextResponse.json(
        { error: 'A webhook with this URL already exists for this workflow' },
        { status: 409 }
      )
    }

    // Prepare update data
    const updateData: WebhookUpdatePayload = {
      url: data.url,
      includeFinalOutput: data.includeFinalOutput,
      includeTraceSpans: data.includeTraceSpans,
      includeRateLimits: data.includeRateLimits,
      includeUsageData: data.includeUsageData,
      levelFilter: data.levelFilter,
      triggerFilter: data.triggerFilter,
      updatedAt: new Date(),
    }

    // Only update secret if provided
    if (data.secret) {
      const { encrypted } = await encryptSecret(data.secret)
      updateData.secret = encrypted
    }

    const updatedWebhooks = await db
      .update(workflowLogWebhook)
      .set(updateData)
      .where(eq(workflowLogWebhook.id, webhookId))
      .returning()

    if (updatedWebhooks.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const updatedWebhook = updatedWebhooks[0]

    logger.info('Webhook updated', {
      webhookId,
      workflowId,
      userId,
    })

    return NextResponse.json({
      data: {
        id: updatedWebhook.id,
        url: updatedWebhook.url,
        includeFinalOutput: updatedWebhook.includeFinalOutput,
        includeTraceSpans: updatedWebhook.includeTraceSpans,
        includeRateLimits: updatedWebhook.includeRateLimits,
        includeUsageData: updatedWebhook.includeUsageData,
        levelFilter: updatedWebhook.levelFilter,
        triggerFilter: updatedWebhook.triggerFilter,
        active: updatedWebhook.active,
        createdAt: updatedWebhook.createdAt.toISOString(),
        updatedAt: updatedWebhook.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to update webhook', { error })
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhookId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId, webhookId } = await params
    const userId = session.user.id

    // Check if user has access to the workflow
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

    // Delete the webhook (will cascade delete deliveries)
    const deletedWebhook = await db
      .delete(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.id, webhookId), eq(workflowLogWebhook.workflowId, workflowId))
      )
      .returning()

    if (deletedWebhook.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    logger.info('Webhook deleted', {
      webhookId,
      workflowId,
      userId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to delete webhook', { error })
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
  }
}
