import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhooksAPI')

export const dynamic = 'force-dynamic'

// Get all webhooks for the current user
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhooks access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    const blockId = searchParams.get('blockId')

    if (workflowId && blockId) {
      // Collaborative-aware path: allow collaborators with read access to view webhooks
      // Fetch workflow to verify access
      const wf = await db
        .select({ id: workflow.id, userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!wf.length) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const wfRecord = wf[0]
      let canRead = wfRecord.userId === session.user.id
      if (!canRead && wfRecord.workspaceId) {
        const permission = await getUserEntityPermissions(
          session.user.id,
          'workspace',
          wfRecord.workspaceId
        )
        canRead = permission === 'read' || permission === 'write' || permission === 'admin'
      }

      if (!canRead) {
        logger.warn(
          `[${requestId}] User ${session.user.id} denied permission to read webhooks for workflow ${workflowId}`
        )
        return NextResponse.json({ webhooks: [] }, { status: 200 })
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
        .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
        .orderBy(desc(webhook.updatedAt))

      logger.info(
        `[${requestId}] Retrieved ${webhooks.length} webhooks for workflow ${workflowId} block ${blockId}`
      )
      return NextResponse.json({ webhooks }, { status: 200 })
    }

    if (workflowId && !blockId) {
      // For now, allow the call but return empty results to avoid breaking the UI
      return NextResponse.json({ webhooks: [] }, { status: 200 })
    }

    // Default: list webhooks owned by the session user
    logger.debug(`[${requestId}] Fetching user-owned webhooks for ${session.user.id}`)
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

    logger.info(`[${requestId}] Retrieved ${webhooks.length} user-owned webhooks`)
    return NextResponse.json({ webhooks }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhooks`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create or Update a webhook
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const userId = (await getSession())?.user?.id

  if (!userId) {
    logger.warn(`[${requestId}] Unauthorized webhook creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { workflowId, path, provider, providerConfig, blockId } = body

    // Validate input
    if (!workflowId) {
      logger.warn(`[${requestId}] Missing required fields for webhook creation`, {
        hasWorkflowId: !!workflowId,
        hasPath: !!path,
      })
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Determine final path with special handling for credential-based providers
    // to avoid generating a new path on every save.
    let finalPath = path
    const credentialBasedProviders = ['gmail', 'outlook']
    const isCredentialBased = credentialBasedProviders.includes(provider)
    // Treat Microsoft Teams chat subscription as credential-based for path generation purposes
    const isMicrosoftTeamsChatSubscription =
      provider === 'microsoft-teams' &&
      typeof providerConfig === 'object' &&
      providerConfig?.triggerId === 'microsoftteams_chat_subscription'

    // If path is missing
    if (!finalPath || finalPath.trim() === '') {
      if (isCredentialBased || isMicrosoftTeamsChatSubscription) {
        // Try to reuse existing path for this workflow+block if one exists
        if (blockId) {
          const existingForBlock = await db
            .select({ id: webhook.id, path: webhook.path })
            .from(webhook)
            .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
            .limit(1)

          if (existingForBlock.length > 0) {
            finalPath = existingForBlock[0].path
            logger.info(
              `[${requestId}] Reusing existing generated path for ${provider} trigger: ${finalPath}`
            )
          }
        }

        // If still no path, generate a new dummy path (first-time save)
        if (!finalPath || finalPath.trim() === '') {
          finalPath = `${provider}-${crypto.randomUUID()}`
          logger.info(`[${requestId}] Generated webhook path for ${provider} trigger: ${finalPath}`)
        }
      } else {
        logger.warn(`[${requestId}] Missing path for webhook creation`, {
          hasWorkflowId: !!workflowId,
          hasPath: !!path,
        })
        return NextResponse.json({ error: 'Missing required path' }, { status: 400 })
      }
    }

    // Check if the workflow exists and user has permission to modify it
    const workflowData = await db
      .select({
        id: workflow.id,
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workflowRecord = workflowData[0]

    // Check if user has permission to modify this workflow
    let canModify = false

    // Case 1: User owns the workflow
    if (workflowRecord.userId === userId) {
      canModify = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canModify && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowRecord.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }

    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to modify webhook for workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Determine existing webhook to update (prefer by workflow+block for credential-based providers)
    let targetWebhookId: string | null = null
    if (isCredentialBased && blockId) {
      const existingForBlock = await db
        .select({ id: webhook.id })
        .from(webhook)
        .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
        .limit(1)
      if (existingForBlock.length > 0) {
        targetWebhookId = existingForBlock[0].id
      }
    }
    if (!targetWebhookId) {
      const existingByPath = await db
        .select({ id: webhook.id, workflowId: webhook.workflowId })
        .from(webhook)
        .where(eq(webhook.path, finalPath))
        .limit(1)
      if (existingByPath.length > 0) {
        // If a webhook with the same path exists but belongs to a different workflow, return an error
        if (existingByPath[0].workflowId !== workflowId) {
          logger.warn(`[${requestId}] Webhook path conflict: ${finalPath}`)
          return NextResponse.json(
            { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
            { status: 409 }
          )
        }
        targetWebhookId = existingByPath[0].id
      }
    }

    let savedWebhook: any = null // Variable to hold the result of save/update

    // Use the original provider config - Gmail/Outlook configuration functions will inject userId automatically
    const finalProviderConfig = providerConfig || {}

    const { resolveEnvVarsInObject } = await import('@/lib/webhooks/env-resolver')
    const resolvedProviderConfig = await resolveEnvVarsInObject(
      finalProviderConfig,
      userId,
      workflowRecord.workspaceId || undefined
    )

    // --- Credential Set Handling ---
    // For credential sets, we fan out to create one webhook per credential at save time.
    // This applies to all OAuth-based triggers, not just polling ones.
    // Check for credentialSetId directly (frontend may already extract it) or credential set value in credential fields
    const rawCredentialId = (resolvedProviderConfig?.credentialId ||
      resolvedProviderConfig?.triggerCredentials) as string | undefined
    const directCredentialSetId = resolvedProviderConfig?.credentialSetId as string | undefined

    if (directCredentialSetId || rawCredentialId) {
      const { isCredentialSetValue, extractCredentialSetId } = await import('@/executor/constants')

      const credentialSetId =
        directCredentialSetId ||
        (rawCredentialId && isCredentialSetValue(rawCredentialId)
          ? extractCredentialSetId(rawCredentialId)
          : null)

      if (credentialSetId) {
        logger.info(
          `[${requestId}] Credential set detected for ${provider} trigger. Syncing webhooks for set ${credentialSetId}`
        )

        const { getProviderIdFromServiceId } = await import('@/lib/oauth')
        const { syncWebhooksForCredentialSet, configureGmailPolling, configureOutlookPolling } =
          await import('@/lib/webhooks/utils.server')

        // Map provider to OAuth provider ID
        const oauthProviderId = getProviderIdFromServiceId(provider)

        const {
          credentialId: _cId,
          triggerCredentials: _tCred,
          credentialSetId: _csId,
          ...baseProviderConfig
        } = resolvedProviderConfig

        try {
          const syncResult = await syncWebhooksForCredentialSet({
            workflowId,
            blockId,
            provider,
            basePath: finalPath,
            credentialSetId,
            oauthProviderId,
            providerConfig: baseProviderConfig,
            requestId,
          })

          if (syncResult.webhooks.length === 0) {
            logger.error(
              `[${requestId}] No webhooks created for credential set - no valid credentials found`
            )
            return NextResponse.json(
              {
                error: `No valid credentials found in credential set for ${provider}`,
                details: 'Please ensure team members have connected their accounts',
              },
              { status: 400 }
            )
          }

          // Configure each new webhook (for providers that need configuration)
          const pollingProviders = ['gmail', 'outlook']
          const needsConfiguration = pollingProviders.includes(provider)

          if (needsConfiguration) {
            const configureFunc =
              provider === 'gmail' ? configureGmailPolling : configureOutlookPolling
            const configureErrors: string[] = []

            for (const wh of syncResult.webhooks) {
              if (wh.isNew) {
                // Fetch the webhook data for configuration
                const webhookRows = await db
                  .select()
                  .from(webhook)
                  .where(eq(webhook.id, wh.id))
                  .limit(1)

                if (webhookRows.length > 0) {
                  const success = await configureFunc(webhookRows[0], requestId)
                  if (!success) {
                    configureErrors.push(
                      `Failed to configure webhook for credential ${wh.credentialId}`
                    )
                    logger.warn(
                      `[${requestId}] Failed to configure ${provider} polling for webhook ${wh.id}`
                    )
                  }
                }
              }
            }

            if (
              configureErrors.length > 0 &&
              configureErrors.length === syncResult.webhooks.length
            ) {
              // All configurations failed - roll back
              logger.error(`[${requestId}] All webhook configurations failed, rolling back`)
              for (const wh of syncResult.webhooks) {
                await db.delete(webhook).where(eq(webhook.id, wh.id))
              }
              return NextResponse.json(
                {
                  error: `Failed to configure ${provider} polling`,
                  details: 'Please check account permissions and try again',
                },
                { status: 500 }
              )
            }
          }

          logger.info(
            `[${requestId}] Successfully synced ${syncResult.webhooks.length} webhooks for credential set ${credentialSetId}`
          )

          // Return the first webhook as the "primary" for the UI
          // The UI will query by credentialSetId to get all of them
          const primaryWebhookRows = await db
            .select()
            .from(webhook)
            .where(eq(webhook.id, syncResult.webhooks[0].id))
            .limit(1)

          return NextResponse.json(
            {
              webhook: primaryWebhookRows[0],
              credentialSetInfo: {
                credentialSetId,
                totalWebhooks: syncResult.webhooks.length,
                created: syncResult.created,
                updated: syncResult.updated,
                deleted: syncResult.deleted,
              },
            },
            { status: syncResult.created > 0 ? 201 : 200 }
          )
        } catch (err) {
          logger.error(`[${requestId}] Error syncing webhooks for credential set`, err)
          return NextResponse.json(
            {
              error: `Failed to configure ${provider} webhook`,
              details: err instanceof Error ? err.message : 'Unknown error',
            },
            { status: 500 }
          )
        }
      }
    }
    // --- End Credential Set Handling ---

    // Create external subscriptions before saving to DB to prevent orphaned records
    let externalSubscriptionId: string | undefined
    let externalSubscriptionCreated = false

    const createTempWebhookData = () => ({
      id: targetWebhookId || nanoid(),
      path: finalPath,
      providerConfig: resolvedProviderConfig,
    })

    if (provider === 'airtable') {
      logger.info(`[${requestId}] Creating Airtable subscription before saving to database`)
      try {
        externalSubscriptionId = await createAirtableWebhookSubscription(
          request,
          userId,
          createTempWebhookData(),
          requestId
        )
        if (externalSubscriptionId) {
          resolvedProviderConfig.externalId = externalSubscriptionId
          externalSubscriptionCreated = true
        }
      } catch (err) {
        logger.error(`[${requestId}] Error creating Airtable webhook subscription`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Airtable',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    if (provider === 'calendly') {
      logger.info(`[${requestId}] Creating Calendly subscription before saving to database`)
      try {
        externalSubscriptionId = await createCalendlyWebhookSubscription(
          request,
          userId,
          createTempWebhookData(),
          requestId
        )
        if (externalSubscriptionId) {
          resolvedProviderConfig.externalId = externalSubscriptionId
          externalSubscriptionCreated = true
        }
      } catch (err) {
        logger.error(`[${requestId}] Error creating Calendly webhook subscription`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Calendly',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    if (provider === 'microsoft-teams') {
      const { createTeamsSubscription } = await import('@/lib/webhooks/provider-subscriptions')
      logger.info(`[${requestId}] Creating Teams subscription before saving to database`)
      try {
        await createTeamsSubscription(request, createTempWebhookData(), workflowRecord, requestId)
        externalSubscriptionCreated = true
      } catch (err) {
        logger.error(`[${requestId}] Error creating Teams subscription`, err)
        return NextResponse.json(
          {
            error: 'Failed to create Teams subscription',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    if (provider === 'telegram') {
      const { createTelegramWebhook } = await import('@/lib/webhooks/provider-subscriptions')
      logger.info(`[${requestId}] Creating Telegram webhook before saving to database`)
      try {
        await createTelegramWebhook(request, createTempWebhookData(), requestId)
        externalSubscriptionCreated = true
      } catch (err) {
        logger.error(`[${requestId}] Error creating Telegram webhook`, err)
        return NextResponse.json(
          {
            error: 'Failed to create Telegram webhook',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    if (provider === 'webflow') {
      logger.info(`[${requestId}] Creating Webflow subscription before saving to database`)
      try {
        externalSubscriptionId = await createWebflowWebhookSubscription(
          request,
          userId,
          createTempWebhookData(),
          requestId
        )
        if (externalSubscriptionId) {
          resolvedProviderConfig.externalId = externalSubscriptionId
          externalSubscriptionCreated = true
        }
      } catch (err) {
        logger.error(`[${requestId}] Error creating Webflow webhook subscription`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Webflow',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    if (provider === 'typeform') {
      const { createTypeformWebhook } = await import('@/lib/webhooks/provider-subscriptions')
      logger.info(`[${requestId}] Creating Typeform webhook before saving to database`)
      try {
        const usedTag = await createTypeformWebhook(request, createTempWebhookData(), requestId)

        if (!resolvedProviderConfig.webhookTag) {
          resolvedProviderConfig.webhookTag = usedTag
          logger.info(`[${requestId}] Stored auto-generated webhook tag: ${usedTag}`)
        }

        externalSubscriptionCreated = true
      } catch (err) {
        logger.error(`[${requestId}] Error creating Typeform webhook`, err)
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Typeform',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }

    // Now save to database (only if subscription succeeded or provider doesn't need external subscription)
    try {
      if (targetWebhookId) {
        logger.info(`[${requestId}] Updating existing webhook for path: ${finalPath}`, {
          webhookId: targetWebhookId,
          provider,
          hasCredentialId: !!(resolvedProviderConfig as any)?.credentialId,
          credentialId: (resolvedProviderConfig as any)?.credentialId,
        })
        const updatedResult = await db
          .update(webhook)
          .set({
            blockId,
            provider,
            providerConfig: resolvedProviderConfig,
            credentialSetId:
              ((resolvedProviderConfig as Record<string, unknown>)?.credentialSetId as
                | string
                | null) || null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, targetWebhookId))
          .returning()
        savedWebhook = updatedResult[0]
        logger.info(`[${requestId}] Webhook updated successfully`, {
          webhookId: savedWebhook.id,
          savedProviderConfig: savedWebhook.providerConfig,
        })
      } else {
        // Create a new webhook
        const webhookId = nanoid()
        logger.info(`[${requestId}] Creating new webhook with ID: ${webhookId}`)
        const newResult = await db
          .insert(webhook)
          .values({
            id: webhookId,
            workflowId,
            blockId,
            path: finalPath,
            provider,
            providerConfig: resolvedProviderConfig,
            credentialSetId:
              ((resolvedProviderConfig as Record<string, unknown>)?.credentialSetId as
                | string
                | null) || null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()
        savedWebhook = newResult[0]
      }
    } catch (dbError) {
      if (externalSubscriptionCreated) {
        logger.error(`[${requestId}] DB save failed, cleaning up external subscription`, dbError)
        try {
          const { cleanupExternalWebhook } = await import('@/lib/webhooks/provider-subscriptions')
          await cleanupExternalWebhook(createTempWebhookData(), workflowRecord, requestId)
        } catch (cleanupError) {
          logger.error(
            `[${requestId}] Failed to cleanup external subscription after DB save failure`,
            cleanupError
          )
        }
      }
      throw dbError
    }

    // --- Gmail/Outlook webhook setup (these don't require external subscriptions, configure after DB save) ---
    if (savedWebhook && provider === 'gmail') {
      logger.info(`[${requestId}] Gmail provider detected. Setting up Gmail webhook configuration.`)
      try {
        const { configureGmailPolling } = await import('@/lib/webhooks/utils.server')
        const success = await configureGmailPolling(savedWebhook, requestId)

        if (!success) {
          logger.error(`[${requestId}] Failed to configure Gmail polling, rolling back webhook`)
          await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
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
        logger.error(
          `[${requestId}] Error setting up Gmail webhook configuration, rolling back webhook`,
          err
        )
        await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
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

    // --- Outlook webhook setup ---
    if (savedWebhook && provider === 'outlook') {
      logger.info(
        `[${requestId}] Outlook provider detected. Setting up Outlook webhook configuration.`
      )
      try {
        const { configureOutlookPolling } = await import('@/lib/webhooks/utils.server')
        const success = await configureOutlookPolling(savedWebhook, requestId)

        if (!success) {
          logger.error(`[${requestId}] Failed to configure Outlook polling, rolling back webhook`)
          await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
          return NextResponse.json(
            {
              error: 'Failed to configure Outlook polling',
              details: 'Please check your Outlook account permissions and try again',
            },
            { status: 500 }
          )
        }

        logger.info(`[${requestId}] Successfully configured Outlook polling`)
      } catch (err) {
        logger.error(
          `[${requestId}] Error setting up Outlook webhook configuration, rolling back webhook`,
          err
        )
        await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
        return NextResponse.json(
          {
            error: 'Failed to configure Outlook webhook',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End Outlook specific logic ---

    // --- RSS webhook setup ---
    if (savedWebhook && provider === 'rss') {
      logger.info(`[${requestId}] RSS provider detected. Setting up RSS webhook configuration.`)
      try {
        const { configureRssPolling } = await import('@/lib/webhooks/utils.server')
        const success = await configureRssPolling(savedWebhook, requestId)

        if (!success) {
          logger.error(`[${requestId}] Failed to configure RSS polling, rolling back webhook`)
          await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
          return NextResponse.json(
            {
              error: 'Failed to configure RSS polling',
              details: 'Please try again',
            },
            { status: 500 }
          )
        }

        logger.info(`[${requestId}] Successfully configured RSS polling`)
      } catch (err) {
        logger.error(
          `[${requestId}] Error setting up RSS webhook configuration, rolling back webhook`,
          err
        )
        await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
        return NextResponse.json(
          {
            error: 'Failed to configure RSS webhook',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End RSS specific logic ---

    if (savedWebhook && provider === 'grain') {
      logger.info(`[${requestId}] Grain provider detected. Creating Grain webhook subscription.`)
      try {
        const grainResult = await createGrainWebhookSubscription(
          request,
          {
            id: savedWebhook.id,
            path: savedWebhook.path,
            providerConfig: savedWebhook.providerConfig,
          },
          requestId
        )

        if (grainResult) {
          // Update the webhook record with the external Grain hook ID and event types for filtering
          const updatedConfig = {
            ...(savedWebhook.providerConfig as Record<string, any>),
            externalId: grainResult.id,
            eventTypes: grainResult.eventTypes,
          }
          await db
            .update(webhook)
            .set({
              providerConfig: updatedConfig,
              updatedAt: new Date(),
            })
            .where(eq(webhook.id, savedWebhook.id))

          savedWebhook.providerConfig = updatedConfig
          logger.info(`[${requestId}] Successfully created Grain webhook`, {
            grainHookId: grainResult.id,
            eventTypes: grainResult.eventTypes,
            webhookId: savedWebhook.id,
          })
        }
      } catch (err) {
        logger.error(
          `[${requestId}] Error creating Grain webhook subscription, rolling back webhook`,
          err
        )
        await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
        return NextResponse.json(
          {
            error: 'Failed to create webhook in Grain',
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    // --- End Grain specific logic ---

    if (!targetWebhookId && savedWebhook) {
      try {
        PlatformEvents.webhookCreated({
          webhookId: savedWebhook.id,
          workflowId: workflowId,
          provider: provider || 'generic',
          workspaceId: workflowRecord.workspaceId || undefined,
        })
      } catch {
        // Telemetry should not fail the operation
      }
    }

    const status = targetWebhookId ? 200 : 201
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
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { baseId, tableId, includeCellValuesInFieldIds } = providerConfig || {}

    if (!baseId || !tableId) {
      logger.warn(`[${requestId}] Missing baseId or tableId for Airtable webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Base ID and Table ID are required to create Airtable webhook. Please provide valid Airtable base and table IDs.'
      )
    }

    const accessToken = await getOAuthToken(userId, 'airtable')
    if (!accessToken) {
      logger.warn(
        `[${requestId}] Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`
      )
      throw new Error(
        'Airtable account connection required. Please connect your Airtable account in the trigger configuration and try again.'
      )
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

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

      let userFriendlyMessage = 'Failed to create webhook subscription in Airtable'
      if (airtableResponse.status === 404) {
        userFriendlyMessage =
          'Airtable base or table not found. Please verify that the Base ID and Table ID are correct and that you have access to them.'
      } else if (errorMessage && errorMessage !== 'Unknown Airtable API error') {
        userFriendlyMessage = `Airtable error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }
    logger.info(
      `[${requestId}] Successfully created webhook in Airtable for webhook ${webhookData.id}.`,
      {
        airtableWebhookId: responseBody.id,
      }
    )
    return responseBody.id
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Airtable webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    // Re-throw the error so it can be caught by the outer try-catch
    throw error
  }
}

// Helper function to create the webhook subscription in Calendly
async function createCalendlyWebhookSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, organization, triggerId } = providerConfig || {}

    if (!apiKey) {
      logger.warn(`[${requestId}] Missing apiKey for Calendly webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Personal Access Token is required to create Calendly webhook. Please provide your Calendly Personal Access Token.'
      )
    }

    if (!organization) {
      logger.warn(`[${requestId}] Missing organization URI for Calendly webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Organization URI is required to create Calendly webhook. Please provide your Organization URI from the "Get Current User" operation.'
      )
    }

    if (!triggerId) {
      logger.warn(`[${requestId}] Missing triggerId for Calendly webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Trigger ID is required to create Calendly webhook')
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    // Map trigger IDs to Calendly event types
    const eventTypeMap: Record<string, string[]> = {
      calendly_invitee_created: ['invitee.created'],
      calendly_invitee_canceled: ['invitee.canceled'],
      calendly_routing_form_submitted: ['routing_form_submission.created'],
      calendly_webhook: ['invitee.created', 'invitee.canceled', 'routing_form_submission.created'],
    }

    const events = eventTypeMap[triggerId] || ['invitee.created']

    const calendlyApiUrl = 'https://api.calendly.com/webhook_subscriptions'

    const requestBody = {
      url: notificationUrl,
      events,
      organization,
      scope: 'organization',
    }

    const calendlyResponse = await fetch(calendlyApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!calendlyResponse.ok) {
      const errorBody = await calendlyResponse.json().catch(() => ({}))
      const errorMessage = errorBody.message || errorBody.title || 'Unknown Calendly API error'
      logger.error(
        `[${requestId}] Failed to create webhook in Calendly for webhook ${webhookData.id}. Status: ${calendlyResponse.status}`,
        { response: errorBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Calendly'
      if (calendlyResponse.status === 401) {
        userFriendlyMessage =
          'Calendly authentication failed. Please verify your Personal Access Token is correct.'
      } else if (calendlyResponse.status === 403) {
        userFriendlyMessage =
          'Calendly access denied. Please ensure you have appropriate permissions and a paid Calendly subscription.'
      } else if (calendlyResponse.status === 404) {
        userFriendlyMessage =
          'Calendly organization not found. Please verify the Organization URI is correct.'
      } else if (errorMessage && errorMessage !== 'Unknown Calendly API error') {
        userFriendlyMessage = `Calendly error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    const responseBody = await calendlyResponse.json()
    const webhookUri = responseBody.resource?.uri

    if (!webhookUri) {
      logger.error(
        `[${requestId}] Calendly webhook created but no webhook URI returned for webhook ${webhookData.id}`,
        { response: responseBody }
      )
      throw new Error('Calendly webhook creation succeeded but no webhook URI was returned')
    }

    // Extract the webhook ID from the URI (e.g., https://api.calendly.com/webhook_subscriptions/WEBHOOK_ID)
    const webhookId = webhookUri.split('/').pop()

    if (!webhookId) {
      logger.error(`[${requestId}] Could not extract webhook ID from Calendly URI: ${webhookUri}`, {
        response: responseBody,
      })
      throw new Error('Failed to extract webhook ID from Calendly response')
    }

    logger.info(
      `[${requestId}] Successfully created webhook in Calendly for webhook ${webhookData.id}.`,
      {
        calendlyWebhookUri: webhookUri,
        calendlyWebhookId: webhookId,
      }
    )
    return webhookId
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Calendly webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    // Re-throw the error so it can be caught by the outer try-catch
    throw error
  }
}

// Helper function to create the webhook subscription in Webflow
async function createWebflowWebhookSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { siteId, triggerId, collectionId, formId } = providerConfig || {}

    if (!siteId) {
      logger.warn(`[${requestId}] Missing siteId for Webflow webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Site ID is required to create Webflow webhook')
    }

    if (!triggerId) {
      logger.warn(`[${requestId}] Missing triggerId for Webflow webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Trigger type is required to create Webflow webhook')
    }

    const accessToken = await getOAuthToken(userId, 'webflow')
    if (!accessToken) {
      logger.warn(
        `[${requestId}] Could not retrieve Webflow access token for user ${userId}. Cannot create webhook in Webflow.`
      )
      throw new Error(
        'Webflow account connection required. Please connect your Webflow account in the trigger configuration and try again.'
      )
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    // Map trigger IDs to Webflow trigger types
    const triggerTypeMap: Record<string, string> = {
      webflow_collection_item_created: 'collection_item_created',
      webflow_collection_item_changed: 'collection_item_changed',
      webflow_collection_item_deleted: 'collection_item_deleted',
      webflow_form_submission: 'form_submission',
    }

    const webflowTriggerType = triggerTypeMap[triggerId]
    if (!webflowTriggerType) {
      logger.warn(`[${requestId}] Invalid triggerId for Webflow: ${triggerId}`, {
        webhookId: webhookData.id,
      })
      throw new Error(`Invalid Webflow trigger type: ${triggerId}`)
    }

    const webflowApiUrl = `https://api.webflow.com/v2/sites/${siteId}/webhooks`

    const requestBody: any = {
      triggerType: webflowTriggerType,
      url: notificationUrl,
    }

    // Add filter for collection-based triggers
    if (collectionId && webflowTriggerType.startsWith('collection_item_')) {
      requestBody.filter = {
        resource_type: 'collection',
        resource_id: collectionId,
      }
    }

    // Add filter for form submissions
    if (formId && webflowTriggerType === 'form_submission') {
      requestBody.filter = {
        resource_type: 'form',
        resource_id: formId,
      }
    }

    const webflowResponse = await fetch(webflowApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await webflowResponse.json()

    if (!webflowResponse.ok || responseBody.error) {
      const errorMessage = responseBody.message || responseBody.error || 'Unknown Webflow API error'
      logger.error(
        `[${requestId}] Failed to create webhook in Webflow for webhook ${webhookData.id}. Status: ${webflowResponse.status}`,
        { message: errorMessage, response: responseBody }
      )
      throw new Error(errorMessage)
    }

    logger.info(
      `[${requestId}] Successfully created webhook in Webflow for webhook ${webhookData.id}.`,
      {
        webflowWebhookId: responseBody.id || responseBody._id,
      }
    )

    return responseBody.id || responseBody._id
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Webflow webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

// Helper function to create the webhook subscription in Grain
async function createGrainWebhookSubscription(
  request: NextRequest,
  webhookData: any,
  requestId: string
): Promise<{ id: string; eventTypes: string[] } | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, triggerId, includeHighlights, includeParticipants, includeAiSummary } =
      providerConfig || {}

    if (!apiKey) {
      logger.warn(`[${requestId}] Missing apiKey for Grain webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Grain API Key is required. Please provide your Grain Personal Access Token in the trigger configuration.'
      )
    }

    // Map trigger IDs to Grain API hook_type (only 2 options: recording_added, upload_status)
    const hookTypeMap: Record<string, string> = {
      grain_webhook: 'recording_added',
      grain_recording_created: 'recording_added',
      grain_recording_updated: 'recording_added',
      grain_highlight_created: 'recording_added',
      grain_highlight_updated: 'recording_added',
      grain_story_created: 'recording_added',
      grain_upload_status: 'upload_status',
    }

    const eventTypeMap: Record<string, string[]> = {
      grain_webhook: [],
      grain_recording_created: ['recording_added'],
      grain_recording_updated: ['recording_updated'],
      grain_highlight_created: ['highlight_created'],
      grain_highlight_updated: ['highlight_updated'],
      grain_story_created: ['story_created'],
      grain_upload_status: ['upload_status'],
    }

    const hookType = hookTypeMap[triggerId] ?? 'recording_added'
    const eventTypes = eventTypeMap[triggerId] ?? []

    if (!hookTypeMap[triggerId]) {
      logger.warn(
        `[${requestId}] Unknown triggerId for Grain: ${triggerId}, defaulting to recording_added`,
        {
          webhookId: webhookData.id,
        }
      )
    }

    logger.info(`[${requestId}] Creating Grain webhook`, {
      triggerId,
      hookType,
      eventTypes,
      webhookId: webhookData.id,
    })

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const grainApiUrl = 'https://api.grain.com/_/public-api/v2/hooks/create'

    const requestBody: Record<string, any> = {
      hook_url: notificationUrl,
      hook_type: hookType,
    }

    // Build include object based on configuration
    const include: Record<string, boolean> = {}
    if (includeHighlights) {
      include.highlights = true
    }
    if (includeParticipants) {
      include.participants = true
    }
    if (includeAiSummary) {
      include.ai_summary = true
    }
    if (Object.keys(include).length > 0) {
      requestBody.include = include
    }

    const grainResponse = await fetch(grainApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Public-Api-Version': '2025-10-31',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await grainResponse.json()

    if (!grainResponse.ok || responseBody.error || responseBody.errors) {
      logger.warn('[App] Grain response body:', responseBody)
      const errorMessage =
        responseBody.errors?.detail ||
        responseBody.error?.message ||
        responseBody.error ||
        responseBody.message ||
        'Unknown Grain API error'
      logger.error(
        `[${requestId}] Failed to create webhook in Grain for webhook ${webhookData.id}. Status: ${grainResponse.status}`,
        { message: errorMessage, response: responseBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Grain'
      if (grainResponse.status === 401) {
        userFriendlyMessage =
          'Invalid Grain API Key. Please verify your Personal Access Token is correct.'
      } else if (grainResponse.status === 403) {
        userFriendlyMessage =
          'Access denied. Please ensure your Grain API Key has appropriate permissions.'
      } else if (errorMessage && errorMessage !== 'Unknown Grain API error') {
        userFriendlyMessage = `Grain error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    logger.info(
      `[${requestId}] Successfully created webhook in Grain for webhook ${webhookData.id}.`,
      {
        grainWebhookId: responseBody.id,
        eventTypes,
      }
    )

    return { id: responseBody.id, eventTypes }
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Grain webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}
