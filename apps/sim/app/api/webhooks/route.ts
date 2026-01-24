import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { resolveEnvVarsInObject } from '@/lib/webhooks/env-resolver'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'
import { mergeNonUserFields } from '@/lib/webhooks/utils'
import {
  configureGmailPolling,
  configureOutlookPolling,
  configureRssPolling,
  syncWebhooksForCredentialSet,
} from '@/lib/webhooks/utils.server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { extractCredentialSetId, isCredentialSetValue } from '@/executor/constants'

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
        .leftJoin(
          workflowDeploymentVersion,
          and(
            eq(workflowDeploymentVersion.workflowId, workflow.id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .where(
          and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            or(
              eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
              and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
            )
          )
        )
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
            .leftJoin(
              workflowDeploymentVersion,
              and(
                eq(workflowDeploymentVersion.workflowId, workflowId),
                eq(workflowDeploymentVersion.isActive, true)
              )
            )
            .where(
              and(
                eq(webhook.workflowId, workflowId),
                eq(webhook.blockId, blockId),
                or(
                  eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
                  and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
                )
              )
            )
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
        .leftJoin(
          workflowDeploymentVersion,
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .where(
          and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            or(
              eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
              and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
            )
          )
        )
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

    let savedWebhook: any = null
    const originalProviderConfig = providerConfig || {}
    let resolvedProviderConfig = await resolveEnvVarsInObject(
      originalProviderConfig,
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
      const credentialSetId =
        directCredentialSetId ||
        (rawCredentialId && isCredentialSetValue(rawCredentialId)
          ? extractCredentialSetId(rawCredentialId)
          : null)

      if (credentialSetId) {
        logger.info(
          `[${requestId}] Credential set detected for ${provider} trigger. Syncing webhooks for set ${credentialSetId}`
        )

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

    let externalSubscriptionCreated = false
    const createTempWebhookData = (providerConfigOverride = resolvedProviderConfig) => ({
      id: targetWebhookId || nanoid(),
      path: finalPath,
      provider,
      providerConfig: providerConfigOverride,
    })

    const userProvided = originalProviderConfig as Record<string, unknown>
    const configToSave: Record<string, unknown> = { ...userProvided }

    try {
      const result = await createExternalWebhookSubscription(
        request,
        createTempWebhookData(),
        workflowRecord,
        userId,
        requestId
      )
      const updatedConfig = result.updatedProviderConfig as Record<string, unknown>
      mergeNonUserFields(configToSave, updatedConfig, userProvided)
      resolvedProviderConfig = updatedConfig
      externalSubscriptionCreated = result.externalSubscriptionCreated
    } catch (err) {
      logger.error(`[${requestId}] Error creating external webhook subscription`, err)
      return NextResponse.json(
        {
          error: 'Failed to create external webhook subscription',
          details: err instanceof Error ? err.message : 'Unknown error',
        },
        { status: 500 }
      )
    }

    try {
      if (targetWebhookId) {
        logger.info(`[${requestId}] Updating existing webhook for path: ${finalPath}`, {
          webhookId: targetWebhookId,
          provider,
          hasCredentialId: !!(configToSave as any)?.credentialId,
          credentialId: (configToSave as any)?.credentialId,
        })
        const updatedResult = await db
          .update(webhook)
          .set({
            blockId,
            provider,
            providerConfig: configToSave,
            credentialSetId:
              ((configToSave as Record<string, unknown>)?.credentialSetId as string | null) || null,
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
            providerConfig: configToSave,
            credentialSetId:
              ((configToSave as Record<string, unknown>)?.credentialSetId as string | null) || null,
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
          await cleanupExternalWebhook(
            createTempWebhookData(configToSave),
            workflowRecord,
            requestId
          )
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
