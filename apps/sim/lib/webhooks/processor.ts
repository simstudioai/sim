import { db, webhook, workflow, workflowDeploymentVersion } from '@sim/db'
import { credentialSet } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { isOrganizationOnTeamOrEnterprisePlan } from '@/lib/billing/core/subscription'
import { tryAdmit } from '@/lib/core/admission/gate'
import { getInlineJobQueue, getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { isProd } from '@/lib/core/config/feature-flags'
import { toError } from '@/lib/core/utils/helpers'
import { generateId } from '@/lib/core/utils/uuid'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import {
  getPendingWebhookVerification,
  matchesPendingWebhookVerificationProbe,
  requiresPendingWebhookVerification,
} from '@/lib/webhooks/pending-verification'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { isPollingWebhookProvider } from '@/triggers/constants'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
  actorUserId?: string
  executionId?: string
  correlation?: AsyncExecutionCorrelation
}

export interface WebhookPreprocessingResult {
  error: NextResponse | null
  actorUserId?: string
  executionId?: string
  correlation?: AsyncExecutionCorrelation
}

async function verifyCredentialSetBilling(credentialSetId: string): Promise<{
  valid: boolean
  error?: string
}> {
  if (!isProd) {
    return { valid: true }
  }

  const [set] = await db
    .select({ organizationId: credentialSet.organizationId })
    .from(credentialSet)
    .where(eq(credentialSet.id, credentialSetId))
    .limit(1)

  if (!set) {
    return { valid: false, error: 'Credential set not found' }
  }

  const hasTeamPlan = await isOrganizationOnTeamOrEnterprisePlan(set.organizationId)
  if (!hasTeamPlan) {
    return {
      valid: false,
      error: 'Credential sets require a Team or Enterprise plan. Please upgrade to continue.',
    }
  }

  return { valid: true }
}

export async function parseWebhookBody(
  request: NextRequest,
  requestId: string
): Promise<{ body: unknown; rawBody: string } | NextResponse> {
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    if (!rawBody || rawBody.length === 0) {
      return { body: {}, rawBody: '' }
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: toError(bodyError).message,
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  let body: unknown
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (payloadString) {
        body = JSON.parse(payloadString)
      } else {
        body = Object.fromEntries(formData.entries())
      }
    } else {
      body = JSON.parse(rawBody)
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: toError(parseError).message,
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new NextResponse('Invalid payload format', { status: 400 })
  }

  return { body, rawBody }
}

/** Providers that implement challenge/verification handling, checked before webhook lookup. */
const CHALLENGE_PROVIDERS = ['monday', 'slack', 'microsoft-teams', 'whatsapp', 'zoom'] as const

export async function handleProviderChallenges(
  body: unknown,
  request: NextRequest,
  requestId: string,
  path: string,
  rawBody?: string
): Promise<NextResponse | null> {
  for (const provider of CHALLENGE_PROVIDERS) {
    const handler = getProviderHandler(provider)
    if (handler.handleChallenge) {
      const response = await handler.handleChallenge(body, request, requestId, path, rawBody)
      if (response) {
        return response
      }
    }
  }
  return null
}

/**
 * Returns a verification response for provider reachability probes that happen
 * before a webhook row exists and therefore before provider lookup is possible.
 */
export async function handlePreLookupWebhookVerification(
  method: string,
  body: Record<string, unknown> | undefined,
  requestId: string,
  path: string
): Promise<NextResponse | null> {
  const pendingVerification = await getPendingWebhookVerification(path)
  if (!pendingVerification) {
    return null
  }

  if (!matchesPendingWebhookVerificationProbe(pendingVerification, { method, body })) {
    return null
  }

  logger.info(
    `[${requestId}] Returning 200 for pending ${pendingVerification.provider} webhook verification on path: ${path}`
  )

  return NextResponse.json({ status: 'ok', message: 'Webhook endpoint verified' })
}

/**
 * Handle provider-specific reachability tests that occur AFTER webhook lookup.
 * Delegates to the provider handler registry.
 */
export function handleProviderReachabilityTest(
  webhookRecord: { provider: string },
  body: unknown,
  requestId: string
): NextResponse | null {
  const handler = getProviderHandler(webhookRecord?.provider)
  return handler.handleReachabilityTest?.(body, requestId) ?? null
}

/**
 * Format error response based on provider requirements.
 * Delegates to the provider handler registry.
 */
export function formatProviderErrorResponse(
  webhookRecord: { provider: string },
  error: string,
  status: number
): NextResponse {
  const handler = getProviderHandler(webhookRecord.provider)
  return handler.formatErrorResponse?.(error, status) ?? NextResponse.json({ error }, { status })
}

/**
 * Check if a webhook event should be skipped based on provider-specific filtering.
 * Delegates to the provider handler registry.
 */
export function shouldSkipWebhookEvent(
  webhookRecord: { provider: string; providerConfig?: Record<string, unknown> },
  body: unknown,
  requestId: string
): boolean {
  const handler = getProviderHandler(webhookRecord.provider)
  const providerConfig = webhookRecord.providerConfig ?? {}
  return (
    handler.shouldSkipEvent?.({ webhook: webhookRecord, body, requestId, providerConfig }) ?? false
  )
}

/** Returns 200 OK for providers that validate URLs before the workflow is deployed */
export function handlePreDeploymentVerification(
  webhookRecord: { provider: string },
  requestId: string
): NextResponse | null {
  if (requiresPendingWebhookVerification(webhookRecord.provider)) {
    logger.info(
      `[${requestId}] ${webhookRecord.provider} webhook - block not in deployment, returning 200 OK for URL validation`
    )
    return NextResponse.json({
      status: 'ok',
      message: 'Webhook endpoint verified',
    })
  }
  return null
}

export async function findWebhookAndWorkflow(
  options: WebhookProcessorOptions
): Promise<{ webhook: any; workflow: any } | null> {
  if (options.webhookId) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
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
          eq(webhook.id, options.webhookId),
          eq(webhook.isActive, true),
          isNull(webhook.archivedAt),
          isNull(workflow.archivedAt),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for id: ${options.webhookId}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  if (options.path) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
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
          eq(webhook.path, options.path),
          eq(webhook.isActive, true),
          isNull(webhook.archivedAt),
          isNull(workflow.archivedAt),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for path: ${options.path}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  return null
}

/**
 * Find ALL webhooks matching a path.
 * Used for credential sets where multiple webhooks share the same path.
 */
export async function findAllWebhooksForPath(
  options: WebhookProcessorOptions
): Promise<Array<{ webhook: any; workflow: any }>> {
  if (!options.path) {
    return []
  }

  const results = await db
    .select({
      webhook: webhook,
      workflow: workflow,
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
        eq(webhook.path, options.path),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  if (results.length === 0) {
    logger.warn(`[${options.requestId}] No active webhooks found for path: ${options.path}`)
  } else if (results.length > 1) {
    logger.info(
      `[${options.requestId}] Found ${results.length} webhooks for path: ${options.path} (credential set fan-out)`
    )
  }

  return results
}

function resolveEnvVars(value: string, envVars: Record<string, string>): string {
  return resolveEnvVarReferences(value, envVars) as string
}

function resolveProviderConfigEnvVars(
  config: Record<string, unknown>,
  envVars: Record<string, string>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      resolved[key] = resolveEnvVars(value, envVars)
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

/**
 * Verify webhook provider authentication and signatures.
 * Delegates to the provider handler registry.
 */
export async function verifyProviderAuth(
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest,
  rawBody: string,
  requestId: string
): Promise<NextResponse | null> {
  let decryptedEnvVars: Record<string, string> = {}
  try {
    decryptedEnvVars = await getEffectiveDecryptedEnv(
      foundWorkflow.userId,
      foundWorkflow.workspaceId
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch environment variables`, {
      error,
    })
  }

  const rawProviderConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
  const providerConfig = resolveProviderConfigEnvVars(rawProviderConfig, decryptedEnvVars)

  const handler = getProviderHandler(foundWebhook.provider)
  if (handler.verifyAuth) {
    const authResult = await handler.verifyAuth({
      webhook: foundWebhook,
      workflow: foundWorkflow,
      request,
      rawBody,
      requestId,
      providerConfig,
    })
    if (authResult) return authResult
  }

  return null
}

/**
 * Run preprocessing checks for webhook execution
 */
export async function checkWebhookPreprocessing(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<WebhookPreprocessingResult> {
  try {
    const executionId = generateId()
    const correlation = {
      executionId,
      requestId,
      source: 'webhook' as const,
      workflowId: foundWorkflow.id,
      webhookId: foundWebhook.id,
      path: foundWebhook.path,
      provider: foundWebhook.provider,
      triggerType: 'webhook',
    }

    const preprocessResult = await preprocessExecution({
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      triggerType: 'webhook',
      executionId,
      requestId,
      triggerData: { correlation },
      checkRateLimit: true,
      checkDeployment: true,
      workspaceId: foundWorkflow.workspaceId,
      workflowRecord: foundWorkflow,
    })

    if (!preprocessResult.success) {
      const error = preprocessResult.error!
      logger.warn(`[${requestId}] Webhook preprocessing failed`, {
        provider: foundWebhook.provider,
        error: error.message,
        statusCode: error.statusCode,
      })

      return {
        error: formatProviderErrorResponse(foundWebhook, error.message, error.statusCode),
      }
    }

    return {
      error: null,
      actorUserId: preprocessResult.actorUserId,
      executionId,
      correlation,
    }
  } catch (preprocessError) {
    logger.error(`[${requestId}] Error during webhook preprocessing:`, preprocessError)

    return {
      error: formatProviderErrorResponse(foundWebhook, 'Internal error during preprocessing', 500),
    }
  }
}

export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  options: WebhookProcessorOptions
): Promise<NextResponse> {
  const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
  const handler = getProviderHandler(foundWebhook.provider)

  try {
    if (handler.matchEvent) {
      const result = await handler.matchEvent({
        webhook: foundWebhook,
        workflow: foundWorkflow,
        body,
        request,
        requestId: options.requestId,
        providerConfig,
      })
      if (result !== true) {
        if (result instanceof NextResponse) {
          return result
        }
        return NextResponse.json({
          message: 'Event type does not match trigger configuration. Ignoring.',
        })
      }
    }

    const { 'x-sim-idempotency-key': _, ...headers } = Object.fromEntries(request.headers.entries())

    if (handler.enrichHeaders) {
      handler.enrichHeaders(
        { webhook: foundWebhook, body, requestId: options.requestId, providerConfig },
        headers
      )
    }

    const credentialId = providerConfig.credentialId as string | undefined
    const credentialSetId = foundWebhook.credentialSetId as string | undefined

    if (credentialSetId) {
      const billingCheck = await verifyCredentialSetBilling(credentialSetId)
      if (!billingCheck.valid) {
        logger.warn(
          `[${options.requestId}] Credential set billing check failed: ${billingCheck.error}`
        )
        return NextResponse.json({ error: billingCheck.error }, { status: 403 })
      }
    }

    const actorUserId = options.actorUserId
    if (!actorUserId) {
      logger.error(`[${options.requestId}] No actorUserId provided for webhook ${foundWebhook.id}`)
      return NextResponse.json({ error: 'Unable to resolve billing account' }, { status: 500 })
    }

    const executionId = options.executionId ?? generateId()
    const correlation =
      options.correlation ??
      ({
        executionId,
        requestId: options.requestId,
        source: 'webhook' as const,
        workflowId: foundWorkflow.id,
        webhookId: foundWebhook.id,
        path: options.path || foundWebhook.path,
        provider: foundWebhook.provider,
        triggerType: 'webhook',
      } satisfies AsyncExecutionCorrelation)

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      executionId,
      requestId: options.requestId,
      correlation,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      workspaceId: foundWorkflow.workspaceId,
      ...(credentialId ? { credentialId } : {}),
    }

    const isPolling = isPollingWebhookProvider(payload.provider)

    if (isPolling && !shouldExecuteInline()) {
      const jobId = await (await getJobQueue()).enqueue('webhook-execution', payload, {
        metadata: {
          workflowId: foundWorkflow.id,
          workspaceId: foundWorkflow.workspaceId,
          userId: actorUserId,
          correlation,
        },
      })
      logger.info(
        `[${options.requestId}] Queued polling webhook execution task ${jobId} for ${foundWebhook.provider} webhook via job queue`
      )
    } else {
      const jobQueue = await getInlineJobQueue()
      const jobId = await jobQueue.enqueue('webhook-execution', payload, {
        metadata: {
          workflowId: foundWorkflow.id,
          workspaceId: foundWorkflow.workspaceId,
          userId: actorUserId,
          correlation,
        },
      })
      logger.info(
        `[${options.requestId}] Queued ${foundWebhook.provider} webhook execution ${jobId} via inline backend`
      )

      void (async () => {
        try {
          await jobQueue.startJob(jobId)
          const output = await executeWebhookJob(payload)
          await jobQueue.completeJob(jobId, output)
        } catch (error) {
          const errorMessage = toError(error).message
          logger.error(`[${options.requestId}] Webhook execution failed`, {
            jobId,
            error: errorMessage,
          })
          try {
            await jobQueue.markJobFailed(jobId, errorMessage)
          } catch (markFailedError) {
            logger.error(`[${options.requestId}] Failed to mark job as failed`, {
              jobId,
              error:
                markFailedError instanceof Error
                  ? markFailedError.message
                  : String(markFailedError),
            })
          }
        }
      })()
    }

    const successResponse = handler.formatSuccessResponse?.(providerConfig) ?? null
    if (successResponse) {
      return successResponse
    }

    return NextResponse.json({ message: 'Webhook processed' })
  } catch (error: unknown) {
    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)

    const errorResponse = handler.formatQueueErrorResponse?.() ?? null
    if (errorResponse) {
      return errorResponse
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export interface PolledWebhookEventResult {
  success: boolean
  error?: string
  statusCode?: number
}

interface PolledWebhookRecord {
  id: string
  path: string
  provider: string | null
  blockId: string | null
  providerConfig: unknown
  credentialSetId: string | null
  workflowId: string
}

interface PolledWorkflowRecord {
  id: string
  userId: string
  workspaceId: string
}

/**
 * Processes a polled webhook event directly, bypassing the HTTP trigger route.
 * Used by polling services (Gmail, Outlook, IMAP, RSS) to avoid the self-POST
 * anti-pattern where they would otherwise POST back to /api/webhooks/trigger/{path}.
 *
 * Performs only the steps actually needed for polling providers:
 * admission control, preprocessing, block existence check, and queue execution.
 */
export async function processPolledWebhookEvent(
  foundWebhook: PolledWebhookRecord,
  foundWorkflow: PolledWorkflowRecord,
  body: Record<string, unknown> | object,
  requestId: string
): Promise<PolledWebhookEventResult> {
  if (!foundWebhook.provider) {
    return { success: false, error: 'Webhook has no provider', statusCode: 400 }
  }
  const provider = foundWebhook.provider

  const ticket = tryAdmit()
  if (!ticket) {
    logger.warn(`[${requestId}] Admission gate rejected polled webhook event`)
    return { success: false, error: 'Server at capacity', statusCode: 429 }
  }

  try {
    const preprocessResult = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
    if (preprocessResult.error) {
      const errorResponse = preprocessResult.error
      const statusCode = errorResponse.status
      const errorBody = await errorResponse.json().catch(() => ({}))
      const errorMessage = errorBody.error ?? 'Preprocessing failed'
      logger.warn(`[${requestId}] Polled webhook preprocessing failed`, {
        statusCode,
        error: errorMessage,
      })
      return { success: false, error: errorMessage, statusCode }
    }

    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        logger.info(
          `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
        )
        return { success: false, error: 'Trigger block not found in deployment', statusCode: 404 }
      }
    }

    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const credentialId = providerConfig.credentialId as string | undefined
    const credentialSetId = foundWebhook.credentialSetId as string | undefined

    if (credentialSetId) {
      const billingCheck = await verifyCredentialSetBilling(credentialSetId)
      if (!billingCheck.valid) {
        logger.warn(`[${requestId}] Credential set billing check failed: ${billingCheck.error}`)
        return { success: false, error: billingCheck.error, statusCode: 403 }
      }
    }

    const actorUserId = preprocessResult.actorUserId
    if (!actorUserId) {
      logger.error(`[${requestId}] No actorUserId provided for webhook ${foundWebhook.id}`)
      return { success: false, error: 'Unable to resolve billing account', statusCode: 500 }
    }

    const executionId = preprocessResult.executionId ?? generateId()
    const correlation =
      preprocessResult.correlation ??
      ({
        executionId,
        requestId,
        source: 'webhook' as const,
        workflowId: foundWorkflow.id,
        webhookId: foundWebhook.id,
        path: foundWebhook.path,
        provider,
        triggerType: 'webhook',
      } satisfies AsyncExecutionCorrelation)

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      executionId,
      requestId,
      correlation,
      provider,
      body,
      headers: { 'content-type': 'application/json' } as Record<string, string>,
      path: foundWebhook.path,
      blockId: foundWebhook.blockId ?? undefined,
      workspaceId: foundWorkflow.workspaceId,
      ...(credentialId ? { credentialId } : {}),
    }

    if (isPollingWebhookProvider(payload.provider) && !shouldExecuteInline()) {
      const jobId = await (await getJobQueue()).enqueue('webhook-execution', payload, {
        metadata: {
          workflowId: foundWorkflow.id,
          workspaceId: foundWorkflow.workspaceId,
          userId: actorUserId,
          correlation,
        },
      })
      logger.info(
        `[${requestId}] Queued polling webhook execution task ${jobId} for ${provider} webhook via job queue`
      )
    } else {
      const jobQueue = await getInlineJobQueue()
      const jobId = await jobQueue.enqueue('webhook-execution', payload, {
        metadata: {
          workflowId: foundWorkflow.id,
          workspaceId: foundWorkflow.workspaceId,
          userId: actorUserId,
          correlation,
        },
      })
      logger.info(`[${requestId}] Queued ${provider} webhook execution ${jobId} via inline backend`)

      void (async () => {
        try {
          await jobQueue.startJob(jobId)
          const output = await executeWebhookJob(payload)
          await jobQueue.completeJob(jobId, output)
        } catch (error) {
          const errorMessage = toError(error).message
          logger.error(`[${requestId}] Webhook execution failed`, {
            jobId,
            error: errorMessage,
          })
          try {
            await jobQueue.markJobFailed(jobId, errorMessage)
          } catch (markFailedError) {
            logger.error(`[${requestId}] Failed to mark job as failed`, {
              jobId,
              error:
                markFailedError instanceof Error
                  ? markFailedError.message
                  : String(markFailedError),
            })
          }
        }
      })()
    }

    return { success: true }
  } catch (error: unknown) {
    logger.error(`[${requestId}] Failed to process polled webhook event:`, error)
    return { success: false, error: 'Internal server error', statusCode: 500 }
  } finally {
    ticket.release()
  }
}
