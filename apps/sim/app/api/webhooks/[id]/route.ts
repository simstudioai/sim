import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { validateInteger } from '@/lib/core/security/input-validation'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WebhookAPI')

export const dynamic = 'force-dynamic'

// Get a specific webhook
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Updating webhook with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { isActive, failedCount } = body

    if (failedCount !== undefined) {
      const validation = validateInteger(failedCount, 'failedCount', { min: 0 })
      if (!validation.isValid) {
        logger.warn(`[${requestId}] ${validation.error}`)
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
    }

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
    let canModify = false

    if (webhookData.workflow.userId === session.user.id) {
      canModify = true
    }

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
      hasActiveUpdate: isActive !== undefined,
      hasFailedCountUpdate: failedCount !== undefined,
    })

    const updatedWebhook = await db
      .update(webhook)
      .set({
        isActive: isActive !== undefined ? isActive : webhooks[0].webhook.isActive,
        failedCount: failedCount !== undefined ? failedCount : webhooks[0].webhook.failedCount,
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
  const requestId = generateRequestId()

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
    const credentialSetId = foundWebhook.credentialSetId as string | undefined
    const blockId = foundWebhook.blockId as string | undefined

    if (credentialSetId && blockId) {
      const allCredentialSetWebhooks = await db
        .select()
        .from(webhook)
        .where(and(eq(webhook.workflowId, webhookData.workflow.id), eq(webhook.blockId, blockId)))

      const webhooksToDelete = allCredentialSetWebhooks.filter(
        (w) => w.credentialSetId === credentialSetId
      )

      for (const w of webhooksToDelete) {
        await cleanupExternalWebhook(w, webhookData.workflow, requestId)
      }

      const idsToDelete = webhooksToDelete.map((w) => w.id)
      for (const wId of idsToDelete) {
        await db.delete(webhook).where(eq(webhook.id, wId))
      }

      try {
        for (const wId of idsToDelete) {
          PlatformEvents.webhookDeleted({
            webhookId: wId,
            workflowId: webhookData.workflow.id,
          })
        }
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(
        `[${requestId}] Successfully deleted ${idsToDelete.length} webhooks for credential set`,
        {
          credentialSetId,
          blockId,
          deletedIds: idsToDelete,
        }
      )
    } else {
      await cleanupExternalWebhook(foundWebhook, webhookData.workflow, requestId)
      await db.delete(webhook).where(eq(webhook.id, id))

      try {
        PlatformEvents.webhookDeleted({
          webhookId: id,
          workflowId: webhookData.workflow.id,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(`[${requestId}] Successfully deleted webhook: ${id}`)
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting webhook`, {
      error: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
