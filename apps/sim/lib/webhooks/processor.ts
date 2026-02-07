import { db, webhook, workflow, workflowDeploymentVersion } from '@sim/db'
import { credentialSet, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { checkEnterprisePlan, checkTeamPlan } from '@/lib/billing/subscriptions/utils'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { isProd } from '@/lib/core/config/feature-flags'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateCalcomSignature,
  validateCirclebackSignature,
  validateFirefliesSignature,
  validateGitHubSignature,
  validateJiraSignature,
  validateLinearSignature,
  validateMicrosoftTeamsSignature,
  validateTwilioSignature,
  validateTypeformSignature,
  verifyProviderWebhook,
} from '@/lib/webhooks/utils.server'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { isGitHubEventMatch } from '@/triggers/github/utils'
import { isHubSpotContactEventMatch } from '@/triggers/hubspot/utils'
import { isJiraEventMatch } from '@/triggers/jira/utils'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
}

function getExternalUrl(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')

  if (host) {
    const url = new URL(request.url)
    const reconstructed = `${proto}://${host}${url.pathname}${url.search}`
    return reconstructed
  }

  return request.url
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

  const [orgSub] = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, set.organizationId), eq(subscription.status, 'active')))
    .limit(1)

  if (!orgSub) {
    return {
      valid: false,
      error: 'Credential sets require a Team or Enterprise plan. Please upgrade to continue.',
    }
  }

  const hasTeamPlan = checkTeamPlan(orgSub) || checkEnterprisePlan(orgSub)
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
): Promise<{ body: any; rawBody: string } | NextResponse> {
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    // Allow empty body - some webhooks send empty payloads
    if (!rawBody || rawBody.length === 0) {
      logger.debug(`[${requestId}] Received request with empty body, treating as empty object`)
      return { body: {}, rawBody: '' }
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (payloadString) {
        body = JSON.parse(payloadString)
        logger.debug(`[${requestId}] Parsed form-encoded GitHub webhook payload`)
      } else {
        body = Object.fromEntries(formData.entries())
        logger.debug(`[${requestId}] Parsed form-encoded webhook data (direct fields)`)
      }
    } else {
      body = JSON.parse(rawBody)
      logger.debug(`[${requestId}] Parsed JSON webhook payload`)
    }

    // Allow empty JSON objects - some webhooks send empty payloads
    if (Object.keys(body).length === 0) {
      logger.debug(`[${requestId}] Received empty JSON object`)
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new NextResponse('Invalid payload format', { status: 400 })
  }

  return { body, rawBody }
}

export async function handleProviderChallenges(
  body: any,
  request: NextRequest,
  requestId: string,
  path: string
): Promise<NextResponse | null> {
  const slackResponse = handleSlackChallenge(body)
  if (slackResponse) {
    return slackResponse
  }

  const url = new URL(request.url)

  // Microsoft Graph subscription validation (can come as GET or POST)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    logger.info(`[${requestId}] Microsoft Graph subscription validation for path: ${path}`)
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
  if (whatsAppResponse) {
    return whatsAppResponse
  }

  return null
}

/**
 * Handle provider-specific reachability tests that occur AFTER webhook lookup.
 *
 * @param webhook - The webhook record from the database
 * @param body - The parsed request body
 * @param requestId - Request ID for logging
 * @returns NextResponse if this is a verification request, null to continue normal flow
 */
export function handleProviderReachabilityTest(
  webhook: any,
  body: any,
  requestId: string
): NextResponse | null {
  const provider = webhook?.provider

  if (provider === 'grain') {
    const isVerificationRequest = !body || Object.keys(body).length === 0 || !body.type
    if (isVerificationRequest) {
      logger.info(
        `[${requestId}] Grain reachability test detected - returning 200 for webhook verification`
      )
      return NextResponse.json({ status: 'ok', message: 'Webhook endpoint verified' })
    }
  }

  return null
}

/**
 * Format error response based on provider requirements.
 * Some providers (like Microsoft Teams) require specific response formats.
 */
export function formatProviderErrorResponse(
  webhook: any,
  error: string,
  status: number
): NextResponse {
  if (webhook.provider === 'microsoft-teams') {
    return NextResponse.json({ type: 'message', text: error }, { status })
  }
  return NextResponse.json({ error }, { status })
}

/**
 * Check if a webhook event should be skipped based on provider-specific filtering.
 * Returns true if the event should be skipped, false if it should be processed.
 */
export function shouldSkipWebhookEvent(webhook: any, body: any, requestId: string): boolean {
  const providerConfig = (webhook.providerConfig as Record<string, any>) || {}

  if (webhook.provider === 'stripe') {
    const eventTypes = providerConfig.eventTypes
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const eventType = body?.type
      if (eventType && !eventTypes.includes(eventType)) {
        logger.info(
          `[${requestId}] Stripe event type '${eventType}' not in allowed list for webhook ${webhook.id}, skipping`
        )
        return true
      }
    }
  }

  if (webhook.provider === 'grain') {
    const eventTypes = providerConfig.eventTypes
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const eventType = body?.type
      if (eventType && !eventTypes.includes(eventType)) {
        logger.info(
          `[${requestId}] Grain event type '${eventType}' not in allowed list for webhook ${webhook.id}, skipping`
        )
        return true
      }
    }
  }

  // Webflow collection filtering - filter by collectionId if configured
  if (webhook.provider === 'webflow') {
    const configuredCollectionId = providerConfig.collectionId
    if (configuredCollectionId) {
      const payloadCollectionId = body?.payload?.collectionId || body?.collectionId
      if (payloadCollectionId && payloadCollectionId !== configuredCollectionId) {
        logger.info(
          `[${requestId}] Webflow collection '${payloadCollectionId}' doesn't match configured collection '${configuredCollectionId}' for webhook ${webhook.id}, skipping`
        )
        return true
      }
    }
  }

  return false
}

/** Providers that validate webhook URLs during creation, before workflow deployment */
const PROVIDERS_WITH_PRE_DEPLOYMENT_VERIFICATION = new Set(['grain'])

/** Returns 200 OK for providers that validate URLs before the workflow is deployed */
export function handlePreDeploymentVerification(
  webhook: any,
  requestId: string
): NextResponse | null {
  if (PROVIDERS_WITH_PRE_DEPLOYMENT_VERIFICATION.has(webhook.provider)) {
    logger.info(
      `[${requestId}] ${webhook.provider} webhook - block not in deployment, returning 200 OK for URL validation`
    )
    return NextResponse.json({ status: 'ok', message: 'Webhook endpoint verified' })
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

/**
 * Resolve {{VARIABLE}} references in a string value
 * @param value - String that may contain {{VARIABLE}} references
 * @param envVars - Already decrypted environment variables
 * @returns String with all {{VARIABLE}} references replaced
 */
function resolveEnvVars(value: string, envVars: Record<string, string>): string {
  return resolveEnvVarReferences(value, envVars) as string
}

/**
 * Resolve environment variables in webhook providerConfig
 * @param config - Raw providerConfig from database (may contain {{VARIABLE}} refs)
 * @param envVars - Already decrypted environment variables
 * @returns New object with resolved values (original config is unchanged)
 */
function resolveProviderConfigEnvVars(
  config: Record<string, any>,
  envVars: Record<string, string>
): Record<string, any> {
  const resolved: Record<string, any> = {}
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
 * Verify webhook provider authentication and signatures
 * @returns NextResponse with 401 if auth fails, null if auth passes
 */
export async function verifyProviderAuth(
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest,
  rawBody: string,
  requestId: string
): Promise<NextResponse | null> {
  // Step 1: Fetch and decrypt environment variables for signature verification
  let decryptedEnvVars: Record<string, string> = {}
  try {
    decryptedEnvVars = await getEffectiveDecryptedEnv(
      foundWorkflow.userId,
      foundWorkflow.workspaceId
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch environment variables`, { error })
  }

  // Step 2: Resolve {{VARIABLE}} references in providerConfig
  const rawProviderConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
  const providerConfig = resolveProviderConfigEnvVars(rawProviderConfig, decryptedEnvVars)

  if (foundWebhook.provider === 'microsoft-teams') {
    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      const isValidSignature = validateMicrosoftTeamsSignature(
        providerConfig.hmacSecret,
        authHeader,
        rawBody
      )

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Microsoft Teams HMAC signature verified successfully`)
    }
  }

  // Provider-specific verification (utils may return a response for some providers)
  const providerVerification = verifyProviderWebhook(foundWebhook, request, requestId)
  if (providerVerification) {
    return providerVerification
  }

  // Handle Google Forms shared-secret authentication (Apps Script forwarder)
  if (foundWebhook.provider === 'google_forms') {
    const expectedToken = providerConfig.token as string | undefined
    const secretHeaderName = providerConfig.secretHeaderName as string | undefined

    if (expectedToken) {
      let isTokenValid = false

      if (secretHeaderName) {
        const headerValue = request.headers.get(secretHeaderName.toLowerCase())
        if (headerValue === expectedToken) {
          isTokenValid = true
        }
      } else {
        const authHeader = request.headers.get('authorization')
        if (authHeader?.toLowerCase().startsWith('bearer ')) {
          const token = authHeader.substring(7)
          if (token === expectedToken) {
            isTokenValid = true
          }
        }
      }

      if (!isTokenValid) {
        logger.warn(`[${requestId}] Google Forms webhook authentication failed`)
        return new NextResponse('Unauthorized - Invalid secret', { status: 401 })
      }
    }
  }

  // Twilio Voice webhook signature verification
  if (foundWebhook.provider === 'twilio_voice') {
    const authToken = providerConfig.authToken as string | undefined

    if (authToken) {
      const signature = request.headers.get('x-twilio-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Twilio Voice webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Twilio signature', { status: 401 })
      }

      let params: Record<string, any> = {}
      try {
        if (typeof rawBody === 'string') {
          const urlParams = new URLSearchParams(rawBody)
          params = Object.fromEntries(urlParams.entries())
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error parsing Twilio webhook body for signature validation:`,
          error
        )
        return new NextResponse('Bad Request - Invalid body format', { status: 400 })
      }

      const fullUrl = getExternalUrl(request)
      const isValidSignature = await validateTwilioSignature(authToken, signature, fullUrl, params)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Twilio Voice signature verification failed`, {
          url: fullUrl,
          signatureLength: signature.length,
          paramsCount: Object.keys(params).length,
          authTokenLength: authToken.length,
        })
        return new NextResponse('Unauthorized - Invalid Twilio signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Twilio Voice signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'typeform') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('Typeform-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Typeform webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Typeform signature', { status: 401 })
      }

      const isValidSignature = validateTypeformSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Typeform signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Typeform signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Typeform signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'linear') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('Linear-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Linear webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Linear signature', { status: 401 })
      }

      const isValidSignature = validateLinearSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Linear signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Linear signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Linear signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'circleback') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('x-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Circleback webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Circleback signature', { status: 401 })
      }

      const isValidSignature = validateCirclebackSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Circleback signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Circleback signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Circleback signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'calcom') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('X-Cal-Signature-256')

      if (!signature) {
        logger.warn(`[${requestId}] Cal.com webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Cal.com signature', { status: 401 })
      }

      const isValidSignature = validateCalcomSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Cal.com signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Cal.com signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Cal.com signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'jira') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('X-Hub-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Jira webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Jira signature', { status: 401 })
      }

      const isValidSignature = validateJiraSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Jira signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Jira signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Jira signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'github') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      // GitHub supports both SHA-256 (preferred) and SHA-1 (legacy)
      const signature256 = request.headers.get('X-Hub-Signature-256')
      const signature1 = request.headers.get('X-Hub-Signature')
      const signature = signature256 || signature1

      if (!signature) {
        logger.warn(`[${requestId}] GitHub webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing GitHub signature', { status: 401 })
      }

      const isValidSignature = validateGitHubSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] GitHub signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
          usingSha256: !!signature256,
        })
        return new NextResponse('Unauthorized - Invalid GitHub signature', { status: 401 })
      }

      logger.debug(`[${requestId}] GitHub signature verified successfully`, {
        usingSha256: !!signature256,
      })
    }
  }

  if (foundWebhook.provider === 'fireflies') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('x-hub-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Fireflies webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Fireflies signature', { status: 401 })
      }

      const isValidSignature = validateFirefliesSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Fireflies signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Fireflies signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Fireflies signature verified successfully`)
    }
  }

  if (foundWebhook.provider === 'generic') {
    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          const headerValue = request.headers.get(secretHeaderName.toLowerCase())
          if (headerValue === configToken) {
            isTokenValid = true
          }
        } else {
          const authHeader = request.headers.get('authorization')
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.substring(7)
            if (token === configToken) {
              isTokenValid = true
            }
          }
        }

        if (!isTokenValid) {
          return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
        }
      } else {
        return new NextResponse('Unauthorized - Authentication required but not configured', {
          status: 401,
        })
      }
    }
  }

  return null
}

/**
 * Run preprocessing checks for webhook execution
 * This replaces the old checkRateLimits and checkUsageLimits functions
 */
export async function checkWebhookPreprocessing(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<NextResponse | null> {
  try {
    const executionId = uuidv4()

    const preprocessResult = await preprocessExecution({
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      triggerType: 'webhook',
      executionId,
      requestId,
      checkRateLimit: true,
      checkDeployment: true,
      workspaceId: foundWorkflow.workspaceId,
    })

    if (!preprocessResult.success) {
      const error = preprocessResult.error!
      logger.warn(`[${requestId}] Webhook preprocessing failed`, {
        provider: foundWebhook.provider,
        error: error.message,
        statusCode: error.statusCode,
      })

      if (foundWebhook.provider === 'microsoft-teams') {
        return NextResponse.json(
          {
            type: 'message',
            text: error.message,
          },
          { status: error.statusCode }
        )
      }

      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.debug(`[${requestId}] Webhook preprocessing passed`, {
      provider: foundWebhook.provider,
    })

    return null
  } catch (preprocessError) {
    logger.error(`[${requestId}] Error during webhook preprocessing:`, preprocessError)

    if (foundWebhook.provider === 'microsoft-teams') {
      return NextResponse.json(
        {
          type: 'message',
          text: 'Internal error during preprocessing',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: 'Internal error during preprocessing' }, { status: 500 })
  }
}

export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  options: WebhookProcessorOptions
): Promise<NextResponse> {
  try {
    // GitHub event filtering for event-specific triggers
    if (foundWebhook.provider === 'github') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId && triggerId !== 'github_webhook') {
        const eventType = request.headers.get('x-github-event')
        const action = body.action

        if (!isGitHubEventMatch(triggerId, eventType || '', action, body)) {
          logger.debug(
            `[${options.requestId}] GitHub event mismatch for trigger ${triggerId}. Event: ${eventType}, Action: ${action}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: eventType,
              receivedAction: action,
            }
          )

          // Return 200 OK to prevent GitHub from retrying
          return NextResponse.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }
      }
    }

    // Jira event filtering for event-specific triggers
    if (foundWebhook.provider === 'jira') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId && triggerId !== 'jira_webhook') {
        const webhookEvent = body.webhookEvent as string | undefined

        if (!isJiraEventMatch(triggerId, webhookEvent || '', body)) {
          logger.debug(
            `[${options.requestId}] Jira event mismatch for trigger ${triggerId}. Event: ${webhookEvent}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: webhookEvent,
            }
          )

          // Return 200 OK to prevent Jira from retrying
          return NextResponse.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }
      }
    }

    if (foundWebhook.provider === 'hubspot') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId?.startsWith('hubspot_')) {
        const events = Array.isArray(body) ? body : [body]
        const firstEvent = events[0]

        const subscriptionType = firstEvent?.subscriptionType as string | undefined

        if (!isHubSpotContactEventMatch(triggerId, subscriptionType || '')) {
          logger.debug(
            `[${options.requestId}] HubSpot event mismatch for trigger ${triggerId}. Event: ${subscriptionType}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: subscriptionType,
            }
          )

          // Return 200 OK to prevent HubSpot from retrying
          return NextResponse.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }

        logger.info(
          `[${options.requestId}] HubSpot event match confirmed for trigger ${triggerId}. Event: ${subscriptionType}`,
          {
            webhookId: foundWebhook.id,
            workflowId: foundWorkflow.id,
            triggerId,
            receivedEvent: subscriptionType,
          }
        )
      }
    }

    const headers = Object.fromEntries(request.headers.entries())

    // For Microsoft Teams Graph notifications, extract unique identifiers for idempotency
    if (
      foundWebhook.provider === 'microsoft-teams' &&
      body?.value &&
      Array.isArray(body.value) &&
      body.value.length > 0
    ) {
      const notification = body.value[0]
      const subscriptionId = notification.subscriptionId
      const messageId = notification.resourceData?.id

      if (subscriptionId && messageId) {
        headers['x-teams-notification-id'] = `${subscriptionId}:${messageId}`
      }
    }

    // Extract credentialId from webhook config
    // Note: Each webhook now has its own credentialId (credential sets are fanned out at save time)
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const credentialId = providerConfig.credentialId as string | undefined
    // credentialSetId is a direct field on webhook table, not in providerConfig
    const credentialSetId = foundWebhook.credentialSetId as string | undefined

    // Verify billing for credential sets
    if (credentialSetId) {
      const billingCheck = await verifyCredentialSetBilling(credentialSetId)
      if (!billingCheck.valid) {
        logger.warn(
          `[${options.requestId}] Credential set billing check failed: ${billingCheck.error}`
        )
        return NextResponse.json({ error: billingCheck.error }, { status: 403 })
      }
    }

    if (!foundWorkflow.workspaceId) {
      logger.error(`[${options.requestId}] Workflow ${foundWorkflow.id} has no workspaceId`)
      return NextResponse.json({ error: 'Workflow has no associated workspace' }, { status: 500 })
    }

    const actorUserId = await getWorkspaceBilledAccountUserId(foundWorkflow.workspaceId)
    if (!actorUserId) {
      logger.error(
        `[${options.requestId}] No billing account for workspace ${foundWorkflow.workspaceId}`
      )
      return NextResponse.json({ error: 'Unable to resolve billing account' }, { status: 500 })
    }

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      ...(credentialId ? { credentialId } : {}),
    }

    const jobQueue = await getJobQueue()
    const jobId = await jobQueue.enqueue('webhook-execution', payload, {
      metadata: { workflowId: foundWorkflow.id, userId: actorUserId },
    })
    logger.info(
      `[${options.requestId}] Queued webhook execution task ${jobId} for ${foundWebhook.provider} webhook`
    )

    if (shouldExecuteInline()) {
      void (async () => {
        try {
          await jobQueue.startJob(jobId)
          const output = await executeWebhookJob(payload)
          await jobQueue.completeJob(jobId, output)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
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

    if (foundWebhook.provider === 'microsoft-teams') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      // Chat subscription (Graph API) returns 202
      if (triggerId === 'microsoftteams_chat_subscription') {
        return new NextResponse(null, { status: 202 })
      }

      // Channel webhook (outgoing webhook) returns message response
      return NextResponse.json({
        type: 'message',
        text: 'Sim',
      })
    }

    // Twilio Voice requires TwiML XML response
    if (foundWebhook.provider === 'twilio_voice') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const twimlResponse = (providerConfig.twimlResponse as string | undefined)?.trim()

      // If user provided custom TwiML, convert square brackets to angle brackets and return
      if (twimlResponse && twimlResponse.length > 0) {
        const convertedTwiml = convertSquareBracketsToTwiML(twimlResponse)
        return new NextResponse(convertedTwiml, {
          status: 200,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
          },
        })
      }

      // Default TwiML if none provided
      const defaultTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Your call is being processed.</Say>
  <Pause length="1"/>
</Response>`

      return new NextResponse(defaultTwiml, {
        status: 200,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
        },
      })
    }

    return NextResponse.json({ message: 'Webhook processed' })
  } catch (error: any) {
    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)

    if (foundWebhook.provider === 'microsoft-teams') {
      return NextResponse.json(
        {
          type: 'message',
          text: 'Webhook processing failed',
        },
        { status: 500 }
      )
    }

    if (foundWebhook.provider === 'twilio_voice') {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, but an error occurred processing your call. Please try again later.</Say>
  <Hangup/>
</Response>`

      return new NextResponse(errorTwiml, {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
