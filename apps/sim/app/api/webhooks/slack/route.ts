import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  checkWebhookPreprocessing,
  findWebhooksByRoutingKey,
  parseWebhookBody,
  queueWebhookExecution,
} from '@/lib/webhooks/processor'
import {
  handleSlackChallenge,
  shouldSkipSlackTriggerEvent,
  verifySlackRequestSignature,
} from '@/lib/webhooks/providers/slack'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'

const logger = createLogger('SlackAppWebhookAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Single ingest endpoint for the official Sim Slack app. Every workspace's
 * events arrive here and are routed to listening workflows by Slack `team_id`
 * (and Slack Connect `authorizations[].team_id`) after HMAC verification with
 * the shared app signing secret. This is the request URL configured in the
 * app's Event Subscriptions.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) {
    return admissionRejectedResponse()
  }

  try {
    return await handleSlackAppWebhook(request)
  } finally {
    ticket.release()
  }
})

async function handleSlackAppWebhook(request: NextRequest): Promise<NextResponse> {
  const receivedAt = Date.now()
  const requestId = generateRequestId()

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }
  const { body, rawBody } = parseResult

  // Slack's endpoint verification handshake — echo the challenge back.
  const challenge = handleSlackChallenge(body)
  if (challenge) {
    return challenge
  }

  const signingSecret = env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    logger.error(`[${requestId}] SLACK_SIGNING_SECRET is not configured`)
    return new NextResponse('Slack app not configured', { status: 500 })
  }

  const authError = verifySlackRequestSignature(signingSecret, request, rawBody, requestId)
  if (authError) {
    return authError
  }

  const payload = body as Record<string, unknown>

  // Route by the installed workspace(s). For Slack Connect the outer `team_id`
  // may be the sender's workspace, so every authorized installation is a
  // routing candidate. Team ids are Slack-attested (post-signature), never user
  // input.
  const teamIds = new Set<string>()
  if (typeof payload.team_id === 'string' && payload.team_id.length > 0) {
    teamIds.add(payload.team_id)
  }
  const authorizations = Array.isArray(payload.authorizations) ? payload.authorizations : []
  for (const authorization of authorizations) {
    const teamId = (authorization as Record<string, unknown>)?.team_id
    if (typeof teamId === 'string' && teamId.length > 0) {
      teamIds.add(teamId)
    }
  }
  if (teamIds.size === 0) {
    logger.warn(`[${requestId}] Slack event missing team_id`)
    return new NextResponse(null, { status: 200 })
  }

  const webhooksById = new Map<string, { webhook: any; workflow: any }>()
  for (const teamId of teamIds) {
    const found = await findWebhooksByRoutingKey(teamId, requestId)
    for (const entry of found) {
      webhooksById.set(entry.webhook.id, entry)
    }
  }
  const webhooks = [...webhooksById.values()]
  if (webhooks.length === 0) {
    return new NextResponse(null, { status: 200 })
  }

  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const triggerTimestampMs = slackRequestTimestamp
    ? Number(slackRequestTimestamp) * 1000
    : undefined

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooks) {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}

    // Apply the shared trigger filter (event, source, threads, emoji, name,
    // channels, self-drop, bot). The custom-app path applies the same via
    // slackHandler.shouldSkipEvent.
    if (shouldSkipSlackTriggerEvent(payload, providerConfig)) {
      continue
    }

    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        logger.info(
          `[${requestId}] Trigger block ${foundWebhook.blockId} not in deployment for ${foundWorkflow.id}`
        )
        continue
      }
    }

    const preprocessResult = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
    if (preprocessResult.error) {
      logger.warn(`[${requestId}] Preprocessing failed for webhook ${foundWebhook.id}`)
      continue
    }

    await queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
      requestId,
      actorUserId: preprocessResult.actorUserId,
      executionId: preprocessResult.executionId,
      correlation: preprocessResult.correlation,
      receivedAt,
      triggerTimestampMs: Number.isFinite(triggerTimestampMs) ? triggerTimestampMs : undefined,
    })
  }

  return new NextResponse(null, { status: 200 })
}
