import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

const logger = createLogger('WebhookAPI')

export const dynamic = 'force-dynamic'

// Get a specific webhook
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Fetching webhook with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const webhookData = webhooks[0]

    // Check if user has permission to access this webhook
    let hasAccess = false

    // Case 1: User owns the workflow
    if (webhookData.workflow.userId === session.user.id) {
      hasAccess = true
    }

    // Case 2: Workflow belongs to a workspace and user has any permission
    if (!hasAccess && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission !== null) {
        hasAccess = true
      }
    }

    if (!hasAccess) {
      logger.warn(`[${requestId}] User ${session.user.id} denied access to webhook: ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    logger.info(`[${requestId}] Successfully retrieved webhook: ${id}`)
    return NextResponse.json({ webhook: webhooks[0] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhook`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Update a webhook
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Updating webhook with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { path, provider, providerConfig, isActive } = body

    // Find the webhook and check permissions
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const webhookData = webhooks[0]

    // Check if user has permission to modify this webhook
    let canModify = false

    // Case 1: User owns the workflow
    if (webhookData.workflow.userId === session.user.id) {
      canModify = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canModify && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }

    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${session.user.id} denied permission to modify webhook: ${id}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    logger.debug(`[${requestId}] Updating webhook properties`, {
      hasPathUpdate: path !== undefined,
      hasProviderUpdate: provider !== undefined,
      hasConfigUpdate: providerConfig !== undefined,
      hasActiveUpdate: isActive !== undefined,
    })

    // Update the webhook
    const updatedWebhook = await db
      .update(webhook)
      .set({
        path: path !== undefined ? path : webhooks[0].webhook.path,
        provider: provider !== undefined ? provider : webhooks[0].webhook.provider,
        providerConfig:
          providerConfig !== undefined ? providerConfig : webhooks[0].webhook.providerConfig,
        isActive: isActive !== undefined ? isActive : webhooks[0].webhook.isActive,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, id))
      .returning()

    logger.info(`[${requestId}] Successfully updated webhook: ${id}`)
    return NextResponse.json({ webhook: updatedWebhook[0] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error updating webhook`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete a webhook
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Deleting webhook with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the webhook and check permissions
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const webhookData = webhooks[0]

    // Check if user has permission to delete this webhook
    let canDelete = false

    // Case 1: User owns the workflow
    if (webhookData.workflow.userId === session.user.id) {
      canDelete = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canDelete && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${session.user.id} denied permission to delete webhook: ${id}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const foundWebhook = webhookData.webhook

    // If it's a Telegram webhook, delete it from Telegram first
    if (foundWebhook.provider === 'telegram') {
      try {
        const { botToken } = foundWebhook.providerConfig as { botToken: string }

        if (!botToken) {
          logger.warn(`[${requestId}] Missing botToken for Telegram webhook deletion.`, {
            webhookId: id,
          })
          return NextResponse.json(
            { error: 'Missing botToken for Telegram webhook deletion' },
            { status: 400 }
          )
        }

        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
        const telegramResponse = await fetch(telegramApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        const responseBody = await telegramResponse.json()
        if (!telegramResponse.ok || !responseBody.ok) {
          const errorMessage =
            responseBody.description ||
            `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
          logger.error(`[${requestId}] ${errorMessage}`, {
            response: responseBody,
          })
          return NextResponse.json(
            { error: 'Failed to delete webhook from Telegram', details: errorMessage },
            { status: 500 }
          )
        }

        logger.info(`[${requestId}] Successfully deleted Telegram webhook for webhook ${id}`)
      } catch (error: any) {
        logger.error(`[${requestId}] Error deleting Telegram webhook`, {
          webhookId: id,
          error: error.message,
          stack: error.stack,
        })
        return NextResponse.json(
          {
            error: 'Failed to delete webhook from Telegram',
            details: error.message,
          },
          { status: 500 }
        )
      }
    }

    // Delete the webhook from the database
    await db.delete(webhook).where(eq(webhook.id, id))

    logger.info(`[${requestId}] Successfully deleted webhook: ${id}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting webhook`, {
      error: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
