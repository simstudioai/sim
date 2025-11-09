import { db, webhook, workflow } from '@sim/db'
import { tasks } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateMicrosoftTeamsSignature,
  verifyProviderWebhook,
} from '@/lib/webhooks/utils.server'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { RateLimiter } from '@/services/queue'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
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

async function resolveWorkflowActorUserId(foundWorkflow: {
  workspaceId?: string | null
  userId?: string | null
}): Promise<string | null> {
  if (foundWorkflow?.workspaceId) {
    const billedAccount = await getWorkspaceBilledAccountUserId(foundWorkflow.workspaceId)
    if (billedAccount) {
      return billedAccount
    }
  }

  return foundWorkflow?.userId ?? null
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
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
  if (whatsAppResponse) {
    return whatsAppResponse
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
      .where(and(eq(webhook.id, options.webhookId), eq(webhook.isActive, true)))
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
      .where(and(eq(webhook.path, options.path), eq(webhook.isActive, true)))
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
 * Resolve {{VARIABLE}} references in a string value
 * @param value - String that may contain {{VARIABLE}} references
 * @param envVars - Already decrypted environment variables
 * @returns String with all {{VARIABLE}} references replaced
 */
function resolveEnvVars(value: string, envVars: Record<string, string>): string {
  const envMatches = value.match(/\{\{([^}]+)\}\}/g)
  if (!envMatches) return value

  let resolvedValue = value
  for (const match of envMatches) {
    const envKey = match.slice(2, -2).trim()
    const envValue = envVars[envKey]
    if (envValue !== undefined) {
      resolvedValue = resolvedValue.replaceAll(match, envValue)
    }
  }
  return resolvedValue
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
    const { getEffectiveDecryptedEnv } = await import('@/lib/environment/utils')
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

  if (foundWebhook.provider === 'microsoftteams') {
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

      const { validateTwilioSignature } = await import('@/lib/webhooks/utils.server')

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

      const { validateTypeformSignature } = await import('@/lib/webhooks/utils.server')

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

      const { validateLinearSignature } = await import('@/lib/webhooks/utils.server')

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

  if (foundWebhook.provider === 'jira') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('X-Hub-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Jira webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Jira signature', { status: 401 })
      }

      const { validateJiraSignature } = await import('@/lib/webhooks/utils.server')

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

      const { validateGitHubSignature } = await import('@/lib/webhooks/utils.server')

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

export async function checkRateLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<NextResponse | null> {
  try {
    const actorUserId = await resolveWorkflowActorUserId(foundWorkflow)

    if (!actorUserId) {
      logger.warn(`[${requestId}] Webhook requires a workspace billing account to attribute usage`)
      return NextResponse.json({ error: 'Workspace billing account required' }, { status: 402 })
    }

    const userSubscription = await getHighestPrioritySubscription(actorUserId)

    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      actorUserId,
      userSubscription,
      'webhook',
      true
    )

    if (!rateLimitCheck.allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for webhook user ${actorUserId}`, {
        provider: foundWebhook.provider,
        remaining: rateLimitCheck.remaining,
        resetAt: rateLimitCheck.resetAt,
      })

      const executionId = uuidv4()
      const loggingSession = new LoggingSession(foundWorkflow.id, executionId, 'webhook', requestId)

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId: foundWorkflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: `Rate limit exceeded. ${rateLimitCheck.remaining || 0} requests remaining. Resets at ${rateLimitCheck.resetAt ? new Date(rateLimitCheck.resetAt).toISOString() : 'unknown'}. Please try again later.`,
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json(
          {
            type: 'message',
            text: 'Rate limit exceeded. Please try again later.',
          },
          { status: 429 }
        )
      }

      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    logger.debug(`[${requestId}] Rate limit check passed for webhook`, {
      provider: foundWebhook.provider,
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })
  } catch (rateLimitError) {
    logger.error(`[${requestId}] Error checking webhook rate limits:`, rateLimitError)
  }

  return null
}

export async function checkUsageLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string,
  testMode: boolean
): Promise<NextResponse | null> {
  if (testMode) {
    logger.debug(`[${requestId}] Skipping usage limit check for test webhook`)
    return null
  }

  try {
    const actorUserId = await resolveWorkflowActorUserId(foundWorkflow)

    if (!actorUserId) {
      logger.warn(`[${requestId}] Webhook requires a workspace billing account to attribute usage`)
      return NextResponse.json({ error: 'Workspace billing account required' }, { status: 402 })
    }

    const usageCheck = await checkServerSideUsageLimits(actorUserId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${actorUserId} has exceeded usage limits. Skipping webhook execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: foundWorkflow.id,
          provider: foundWebhook.provider,
        }
      )

      const executionId = uuidv4()
      const loggingSession = new LoggingSession(foundWorkflow.id, executionId, 'webhook', requestId)

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId: foundWorkflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message:
            usageCheck.message ||
            'Usage limit exceeded. Please upgrade your plan to continue using webhooks.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json(
          {
            type: 'message',
            text: 'Usage limit exceeded. Please upgrade your plan to continue.',
          },
          { status: 402 }
        )
      }

      return NextResponse.json(
        { error: usageCheck.message || 'Usage limit exceeded' },
        { status: 402 }
      )
    }

    logger.debug(`[${requestId}] Usage limit check passed for webhook`, {
      provider: foundWebhook.provider,
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
  } catch (usageError) {
    logger.error(`[${requestId}] Error checking webhook usage limits:`, usageError)
  }

  return null
}

export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  options: WebhookProcessorOptions
): Promise<NextResponse> {
  try {
    const actorUserId = await resolveWorkflowActorUserId(foundWorkflow)
    if (!actorUserId) {
      logger.warn(
        `[${options.requestId}] Webhook requires a workspace billing account to attribute usage`
      )
      return NextResponse.json({ error: 'Workspace billing account required' }, { status: 402 })
    }

    // GitHub event filtering for event-specific triggers
    if (foundWebhook.provider === 'github') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId && triggerId !== 'github_webhook') {
        const eventType = request.headers.get('x-github-event')
        const action = body.action

        const { isGitHubEventMatch } = await import('@/triggers/github/utils')

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

        const { isJiraEventMatch } = await import('@/triggers/jira/utils')

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

        const { isHubSpotContactEventMatch } = await import('@/triggers/hubspot/utils')

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
      foundWebhook.provider === 'microsoftteams' &&
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

    // Extract credentialId from webhook config for credential-based webhooks
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const credentialId = providerConfig.credentialId as string | undefined

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      testMode: options.testMode,
      executionTarget: options.executionTarget,
      ...(credentialId ? { credentialId } : {}),
    }

    const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

    if (useTrigger) {
      const handle = await tasks.trigger('webhook-execution', payload)
      logger.info(
        `[${options.requestId}] Queued ${options.testMode ? 'TEST ' : ''}webhook execution task ${
          handle.id
        } for ${foundWebhook.provider} webhook`
      )
    } else {
      void executeWebhookJob(payload).catch((error) => {
        logger.error(`[${options.requestId}] Direct webhook execution failed`, error)
      })
      logger.info(
        `[${options.requestId}] Queued direct ${
          options.testMode ? 'TEST ' : ''
        }webhook execution for ${foundWebhook.provider} webhook (Trigger.dev disabled)`
      )
    }

    if (foundWebhook.provider === 'microsoftteams') {
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

    if (foundWebhook.provider === 'microsoftteams') {
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
