import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'

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

// Update a webhook
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

    // If it's an Airtable webhook, delete it from Airtable first
    if (foundWebhook.provider === 'airtable') {
      try {
        const { baseId, externalId } = (foundWebhook.providerConfig || {}) as {
          baseId?: string
          externalId?: string
        }

        if (!baseId) {
          logger.warn(`[${requestId}] Missing baseId for Airtable webhook deletion.`, {
            webhookId: id,
          })
          return NextResponse.json(
            { error: 'Missing baseId for Airtable webhook deletion' },
            { status: 400 }
          )
        }

        // Get access token for the workflow owner
        const userIdForToken = webhookData.workflow.userId
        const accessToken = await getOAuthToken(userIdForToken, 'airtable')
        if (!accessToken) {
          logger.warn(
            `[${requestId}] Could not retrieve Airtable access token for user ${userIdForToken}. Cannot delete webhook in Airtable.`,
            { webhookId: id }
          )
          return NextResponse.json(
            { error: 'Airtable access token not found for webhook deletion' },
            { status: 401 }
          )
        }

        // Resolve externalId if missing by listing webhooks and matching our notificationUrl
        let resolvedExternalId: string | undefined = externalId

        if (!resolvedExternalId) {
          try {
            if (!env.NEXT_PUBLIC_APP_URL) {
              logger.error(
                `[${requestId}] NEXT_PUBLIC_APP_URL not configured, cannot match Airtable webhook`
              )
              throw new Error('NEXT_PUBLIC_APP_URL must be configured')
            }
            const expectedNotificationUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/trigger/${foundWebhook.path}`

            const listUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`
            const listResp = await fetch(listUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            })
            const listBody = await listResp.json().catch(() => null)

            if (listResp.ok && listBody && Array.isArray(listBody.webhooks)) {
              const match = listBody.webhooks.find((w: any) => {
                const url: string | undefined = w?.notificationUrl
                if (!url) return false
                // Prefer exact match; fallback to suffix match to handle origin/host remaps
                return (
                  url === expectedNotificationUrl ||
                  url.endsWith(`/api/webhooks/trigger/${foundWebhook.path}`)
                )
              })
              if (match?.id) {
                resolvedExternalId = match.id as string
                // Persist resolved externalId for future operations
                try {
                  await db
                    .update(webhook)
                    .set({
                      providerConfig: {
                        ...(foundWebhook.providerConfig || {}),
                        externalId: resolvedExternalId,
                      },
                      updatedAt: new Date(),
                    })
                    .where(eq(webhook.id, id))
                } catch {
                  // non-fatal persistence error
                }
                logger.info(`[${requestId}] Resolved Airtable externalId by listing webhooks`, {
                  baseId,
                  externalId: resolvedExternalId,
                })
              } else {
                logger.warn(`[${requestId}] Could not resolve Airtable externalId from list`, {
                  baseId,
                  expectedNotificationUrl,
                })
              }
            } else {
              logger.warn(`[${requestId}] Failed to list Airtable webhooks to resolve externalId`, {
                baseId,
                status: listResp.status,
                body: listBody,
              })
            }
          } catch (e: any) {
            logger.warn(`[${requestId}] Error attempting to resolve Airtable externalId`, {
              error: e?.message,
            })
          }
        }

        // If still not resolvable, skip remote deletion but proceed with local delete
        if (!resolvedExternalId) {
          logger.info(
            `[${requestId}] Airtable externalId not found; skipping remote deletion and proceeding to remove local record`,
            { baseId }
          )
        }

        if (resolvedExternalId) {
          const airtableDeleteUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks/${resolvedExternalId}`
          const airtableResponse = await fetch(airtableDeleteUrl, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })

          // Attempt to parse error body for better diagnostics
          if (!airtableResponse.ok) {
            let responseBody: any = null
            try {
              responseBody = await airtableResponse.json()
            } catch {
              // ignore parse errors
            }

            logger.error(
              `[${requestId}] Failed to delete Airtable webhook in Airtable. Status: ${airtableResponse.status}`,
              { baseId, externalId: resolvedExternalId, response: responseBody }
            )
            return NextResponse.json(
              {
                error: 'Failed to delete webhook from Airtable',
                details:
                  (responseBody && (responseBody.error?.message || responseBody.error)) ||
                  `Status ${airtableResponse.status}`,
              },
              { status: 500 }
            )
          }

          logger.info(`[${requestId}] Successfully deleted Airtable webhook in Airtable`, {
            baseId,
            externalId: resolvedExternalId,
          })
        }
      } catch (error: any) {
        logger.error(`[${requestId}] Error deleting Airtable webhook`, {
          webhookId: id,
          error: error.message,
          stack: error.stack,
        })
        return NextResponse.json(
          { error: 'Failed to delete webhook from Airtable', details: error.message },
          { status: 500 }
        )
      }
    }

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
