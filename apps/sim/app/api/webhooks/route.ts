import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listWebhooksContract, upsertWebhookContract } from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { resolveEnvVarsInObject } from '@/lib/webhooks/env-resolver'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
  shouldRecreateExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { mergeNonUserFields } from '@/lib/webhooks/utils'
import { findConflictingWebhookPathOwner } from '@/lib/webhooks/utils.server'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('WebhooksAPI')

export const dynamic = 'force-dynamic'

async function revertSavedWebhook(
  savedWebhook: any,
  existingWebhook: any,
  requestId: string
): Promise<void> {
  if (existingWebhook) {
    await db
      .update(webhook)
      .set({
        workflowId: existingWebhook.workflowId,
        blockId: existingWebhook.blockId,
        path: existingWebhook.path,
        provider: existingWebhook.provider,
        providerConfig: existingWebhook.providerConfig,
        isActive: existingWebhook.isActive,
        archivedAt: existingWebhook.archivedAt,
        updatedAt: existingWebhook.updatedAt,
      })
      .where(eq(webhook.id, savedWebhook.id))
    logger.info(`[${requestId}] Restored previous webhook configuration after failed re-save`, {
      webhookId: savedWebhook.id,
    })
    return
  }

  await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
}

// Get all webhooks for the current user
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhooks access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listWebhooksContract, request, {})
    if (!parsed.success) return parsed.response
    const { workflowId, blockId } = parsed.data.query

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
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: wfRecord.id,
        userId: session.user.id,
        action: 'read',
      })
      const canRead = authorization.allowed

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
            isNull(webhook.archivedAt),
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

    const accessibleRows = await listAccessibleWorkspaceRowsForUser(session.user.id, 'all')
    const workspaceIds = accessibleRows.map((row) => row.workspace.id)
    if (workspaceIds.length === 0) {
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
      .where(and(inArray(workflow.workspaceId, workspaceIds), isNull(webhook.archivedAt)))

    logger.info(`[${requestId}] Retrieved ${webhooks.length} workspace-accessible webhooks`)
    return NextResponse.json({ webhooks }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhooks`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

// Create or Update a webhook
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()
  const userId = session?.user?.id

  if (!userId) {
    logger.warn(`[${requestId}] Unauthorized webhook creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(upsertWebhookContract, request, {})
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const { workflowId, path, providerConfig, blockId } = body
    const provider = body.provider || ''

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
                isNull(webhook.archivedAt),
                or(
                  eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
                  and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
                )
              )
            )
            .limit(1)

          if (existingForBlock.length > 0) {
            finalPath = existingForBlock[0].path ?? ''
            logger.info(
              `[${requestId}] Reusing existing generated path for ${provider} trigger: ${finalPath}`
            )
          }
        }

        // If still no path, generate a new dummy path (first-time save)
        if (!finalPath || finalPath.trim() === '') {
          finalPath = `${provider}-${generateId()}`
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

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'write',
    })
    const canModify = authorization.allowed

    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to modify webhook for workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    await assertWorkflowMutable(workflowId)

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
            isNull(webhook.archivedAt),
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
      const conflictingOwner = await findConflictingWebhookPathOwner({
        path: finalPath,
        workflowId,
      })
      if (conflictingOwner) {
        logger.warn(`[${requestId}] Webhook path conflict: ${finalPath}`)
        return NextResponse.json(
          { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
          { status: 409 }
        )
      }

      const ownExisting = await db
        .select({ id: webhook.id })
        .from(webhook)
        .where(
          and(
            eq(webhook.path, finalPath),
            eq(webhook.workflowId, workflowId),
            isNull(webhook.archivedAt)
          )
        )
        .limit(1)
      if (ownExisting.length > 0) {
        targetWebhookId = ownExisting[0].id
      }
    }

    let savedWebhook: any = null
    let existingWebhook: any = null
    const originalProviderConfig = providerConfig || {}
    let resolvedProviderConfig = await resolveEnvVarsInObject(
      originalProviderConfig,
      userId,
      workflowRecord.workspaceId || undefined
    )

    let externalSubscriptionCreated = false
    const createTempWebhookData = (providerConfigOverride = resolvedProviderConfig) => ({
      id: targetWebhookId || generateShortId(),
      path: finalPath,
      provider,
      providerConfig: providerConfigOverride,
    })

    const userProvided = originalProviderConfig as Record<string, unknown>
    const configToSave: Record<string, unknown> = { ...userProvided }

    if (targetWebhookId) {
      const existingRows = await db
        .select()
        .from(webhook)
        .where(eq(webhook.id, targetWebhookId))
        .limit(1)
      existingWebhook = existingRows[0] || null
    }

    const shouldRecreateSubscription =
      existingWebhook &&
      shouldRecreateExternalWebhookSubscription({
        previousProvider: existingWebhook.provider as string,
        nextProvider: provider,
        previousConfig: ((existingWebhook.providerConfig as Record<string, unknown>) ||
          {}) as Record<string, unknown>,
        nextConfig: resolvedProviderConfig,
      })

    if (!existingWebhook || shouldRecreateSubscription) {
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
            details: getErrorMessage(err, 'Unknown error'),
          },
          { status: 500 }
        )
      }
    } else {
      mergeNonUserFields(
        configToSave,
        (existingWebhook.providerConfig as Record<string, unknown>) || {},
        userProvided
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
        const webhookId = generateShortId()
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

    if (existingWebhook && shouldRecreateSubscription) {
      try {
        await cleanupExternalWebhook(existingWebhook, workflowRecord, requestId)
      } catch (cleanupError) {
        logger.warn(
          `[${requestId}] Failed to cleanup previous external webhook subscription ${existingWebhook.id}`,
          cleanupError
        )
      }
    }

    if (savedWebhook) {
      const pollingHandler = getProviderHandler(provider)
      if (pollingHandler.configurePolling) {
        logger.info(
          `[${requestId}] ${provider} provider detected. Setting up polling configuration.`
        )
        try {
          const success = await pollingHandler.configurePolling({
            webhook: savedWebhook,
            requestId,
          })

          if (!success) {
            logger.error(
              `[${requestId}] Failed to configure ${provider} polling, rolling back webhook`
            )
            await revertSavedWebhook(savedWebhook, existingWebhook, requestId)
            return NextResponse.json(
              {
                error: `Failed to configure ${provider} polling`,
                details: 'Please check your account permissions and try again',
              },
              { status: 500 }
            )
          }

          logger.info(`[${requestId}] Successfully configured ${provider} polling`)
        } catch (err) {
          logger.error(
            `[${requestId}] Error setting up ${provider} webhook configuration, rolling back webhook`,
            err
          )
          await revertSavedWebhook(savedWebhook, existingWebhook, requestId)
          return NextResponse.json(
            {
              error: `Failed to configure ${provider} webhook`,
              details: getErrorMessage(err, 'Unknown error'),
            },
            { status: 500 }
          )
        }
      }
    }

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

      recordAudit({
        workspaceId: workflowRecord.workspaceId || null,
        actorId: userId,
        actorName: session?.user?.name ?? undefined,
        actorEmail: session?.user?.email ?? undefined,
        action: AuditAction.WEBHOOK_CREATED,
        resourceType: AuditResourceType.WEBHOOK,
        resourceId: savedWebhook.id,
        resourceName: provider || 'generic',
        description: `Created ${provider || 'generic'} webhook`,
        metadata: {
          provider: provider || 'generic',
          workflowId,
          webhookPath: finalPath,
          blockId: blockId || undefined,
        },
        request,
      })

      const wsId = workflowRecord.workspaceId || undefined
      captureServerEvent(
        userId,
        'webhook_trigger_created',
        {
          webhook_id: savedWebhook.id,
          workflow_id: workflowId,
          provider: provider || 'generic',
          workspace_id: wsId ?? '',
        },
        wsId ? { groups: { workspace: wsId } } : undefined
      )
    }

    const status = targetWebhookId ? 200 : 201
    return NextResponse.json({ webhook: savedWebhook }, { status })
  } catch (error: any) {
    if (error instanceof WorkflowLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error creating/updating webhook`, {
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
