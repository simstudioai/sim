import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { getOAuthToken } from '../auth/oauth/utils'

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

// Create or Update a webhook
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const userId = (await getSession())?.user?.id

  if (!userId) {
    logger.warn(`[${requestId}] Unauthorized webhook creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
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

    // Check if the workflow belongs to the user
    const workflows = await db
      .select({ id: workflow.id }) // Select only necessary field
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
      .limit(1)

    if (workflows.length === 0) {
      logger.warn(`[${requestId}] Workflow not found or not owned by user: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if a webhook with the same path already exists
    const existingWebhooks = await db
      .select({ id: webhook.id, workflowId: webhook.workflowId })
      .from(webhook)
      .where(eq(webhook.path, path))
      .limit(1)

    let savedWebhook: any = null // Variable to hold the result of save/update

    // If a webhook with the same path exists but belongs to a different workflow, return an error
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId !== workflowId) {
      logger.warn(`[${requestId}] Webhook path conflict: ${path}`)
      return NextResponse.json(
        { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
        { status: 409 }
      )
    }

    // If a webhook with the same path and workflowId exists, update it
    if (existingWebhooks.length > 0 && existingWebhooks[0].workflowId === workflowId) {
      logger.info(`[${requestId}] Updating existing webhook for path: ${path}`)
      const updatedResult = await db
        .update(webhook)
        .set({
          provider,
          providerConfig,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, existingWebhooks[0].id))
        .returning()
      savedWebhook = updatedResult[0]
    } else {
      // Create a new webhook
      const webhookId = nanoid()
      logger.info(`[${requestId}] Creating new webhook with ID: ${webhookId}`)
      const newResult = await db
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
      savedWebhook = newResult[0]
    }

    // --- Attempt to create webhook in Airtable if provider is 'airtable' ---
    if (savedWebhook && provider === 'airtable') {
      logger.info(
        `[${requestId}] Airtable provider detected. Attempting to create webhook in Airtable.`
      )
      try {
        await createAirtableWebhookSubscription(request, userId, savedWebhook, requestId)
      } catch (err) {
        logger.error(`[${requestId}] Error creating Airtable webhook`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Airtable',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End Airtable specific logic ---

    // --- Attempt to create webhook in Telegram if provider is 'telegram' ---
    if (savedWebhook && provider === 'telegram') {
      logger.info(
        `[${requestId}] Telegram provider detected. Attempting to create webhook in Telegram.`
      )
      try {
        await createTelegramWebhookSubscription(request, userId, savedWebhook, requestId)
      } catch (err) {
        logger.error(`[${requestId}] Error creating Telegram webhook`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Telegram',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End Telegram specific logic ---

    // --- Gmail webhook setup ---
    if (savedWebhook && provider === 'gmail') {
      logger.info(
        `[${requestId}] Gmail provider detected. Setting up Gmail webhook configuration.`
      )
      try {
        const { configureGmailPolling } = await import('@/lib/webhooks/utils')
        const success = await configureGmailPolling(userId, savedWebhook, requestId)
        
        if (!success) {
          logger.error(`[${requestId}] Failed to configure Gmail polling`)
          return NextResponse.json(
            {
              error: 'Failed to configure Gmail polling',
              details: 'Please check your Gmail account permissions and try again',
            },
            { status: 500 }
          )
        }
        
        logger.info(`[${requestId}] Successfully configured Gmail polling`)
      } catch (err) {
        logger.error(`[${requestId}] Error setting up Gmail webhook configuration`, err)
        return NextResponse.json(
          {
            error: 'Failed to configure Gmail webhook',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End Gmail specific logic ---

    const status = existingWebhooks.length > 0 ? 200 : 201
    return NextResponse.json({ webhook: savedWebhook }, { status })
  } catch (error: any) {
    logger.error(`[${requestId}] Error creating/updating webhook`, {
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper function to create the webhook subscription in Airtable
async function createAirtableWebhookSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
) {
  try {
    const { path, providerConfig } = webhookData
    const { baseId, tableId, includeCellValuesInFieldIds } = providerConfig || {}

    if (!baseId || !tableId) {
      logger.warn(`[${requestId}] Missing baseId or tableId for Airtable webhook creation.`, {
        webhookId: webhookData.id,
      })
      return // Cannot proceed without base/table IDs
    }

    const accessToken = await getOAuthToken(userId, 'airtable') // Use 'airtable' as the providerId key
    if (!accessToken) {
      logger.warn(
        `[${requestId}] Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`
      )
      return
    }

    const requestOrigin = new URL(request.url).origin
    // Ensure origin does not point to localhost for external API calls
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? process.env.NEXT_PUBLIC_APP_URL || requestOrigin // Use env var if available, fallback to original
      : requestOrigin

    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${path}`
    if (effectiveOrigin !== requestOrigin) {
      logger.debug(
        `[${requestId}] Remapped localhost origin to ${effectiveOrigin} for notificationUrl`
      )
    }

    const airtableApiUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`

    const specification: any = {
      options: {
        filters: {
          dataTypes: ['tableData'], // Watch table data changes
          recordChangeScope: tableId, // Watch only the specified table
        },
      },
    }

    // Conditionally add the 'includes' field based on the config
    if (includeCellValuesInFieldIds === 'all') {
      specification.options.includes = {
        includeCellValuesInFieldIds: 'all',
      }
    }

    const requestBody: any = {
      notificationUrl: notificationUrl,
      specification: specification,
    }

    const airtableResponse = await fetch(airtableApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    // Airtable often returns 200 OK even for errors in the body, check payload
    const responseBody = await airtableResponse.json()

    if (!airtableResponse.ok || responseBody.error) {
      const errorMessage =
        responseBody.error?.message || responseBody.error || 'Unknown Airtable API error'
      const errorType = responseBody.error?.type
      logger.error(
        `[${requestId}] Failed to create webhook in Airtable for webhook ${webhookData.id}. Status: ${airtableResponse.status}`,
        { type: errorType, message: errorMessage, response: responseBody }
      )
    } else {
      logger.info(
        `[${requestId}] Successfully created webhook in Airtable for webhook ${webhookData.id}.`,
        { airtableWebhookId: responseBody.id }
      )
      // Store the airtableWebhookId (responseBody.id) within the providerConfig
      try {
        const currentConfig = (webhookData.providerConfig as Record<string, any>) || {}
        const updatedConfig = {
          ...currentConfig,
          externalId: responseBody.id, // Add/update the externalId
        }
        await db
          .update(webhook)
          .set({ providerConfig: updatedConfig, updatedAt: new Date() })
          .where(eq(webhook.id, webhookData.id))
      } catch (dbError: any) {
        logger.error(
          `[${requestId}] Failed to store externalId in providerConfig for webhook ${webhookData.id}.`,
          dbError
        )
        // Even if saving fails, the webhook exists in Airtable. Log and continue.
      }
    }
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Airtable webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
  }
}

// Helper function to create the webhook subscription in Telegram
async function createTelegramWebhookSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
) {
  try {
    const { path, providerConfig } = webhookData
    const { botToken, triggerPhrase } = providerConfig || {}

    if (!botToken || !triggerPhrase) {
      logger.warn(
        `[${requestId}] Missing botToken or triggerPhrase for Telegram webhook creation.`,
        {
          webhookId: webhookData.id,
        }
      )
      return // Cannot proceed without botToken and triggerPhrase
    }

    const requestOrigin = new URL(request.url).origin
    // Ensure origin does not point to localhost for external API calls
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? process.env.NEXT_PUBLIC_APP_URL || requestOrigin // Use env var if available, fallback to original
      : requestOrigin

    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${path}`
    if (effectiveOrigin !== requestOrigin) {
      logger.debug(
        `[${requestId}] Remapped localhost origin to ${effectiveOrigin} for notificationUrl`
      )
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`

    const requestBody: any = {
      url: notificationUrl,
      allowed_updates: ['message'],
    }

    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
      logger.error(`[${requestId}] ${errorMessage}`, {
        response: responseBody,
      })
      throw new Error(errorMessage)
    }

    logger.info(
      `[${requestId}] Successfully created Telegram webhook for webhook ${webhookData.id}.`
    )
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Telegram webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
  }
}
