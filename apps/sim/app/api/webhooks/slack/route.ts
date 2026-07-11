import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findWebhooksByRoutingKey, parseWebhookBody } from '@/lib/webhooks/processor'
import { handleSlackChallenge, verifySlackRequestSignature } from '@/lib/webhooks/providers/slack'
import { dispatchSlackWebhooks } from '@/lib/webhooks/slack-dispatch'

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
  // Interactivity payloads (block_actions / view_submission) carry no top-level
  // `team_id` / `authorizations`; the install/context workspace is at
  // `payload.team.id`. Route on that ONLY — never `payload.user.team_id`, which
  // in Slack Connect can be a different (external) tenant. Slack-attested,
  // post-signature, so not user-forgeable.
  if (teamIds.size === 0) {
    const interactionTeamId = (payload.team as Record<string, unknown> | undefined)?.id
    if (typeof interactionTeamId === 'string' && interactionTeamId.length > 0) {
      teamIds.add(interactionTeamId)
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

  await dispatchSlackWebhooks(webhooks, { body, request, requestId, receivedAt })

  return new NextResponse(null, { status: 200 })
}
