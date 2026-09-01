import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseWebhookBody } from '@/lib/webhooks/processor'
import { handleSlackChallenge } from '@/lib/webhooks/providers/slack'
import {
  dispatchSlackCustomBotCredential,
  verifySlackCustomBotCredentialRequest,
} from '@/lib/webhooks/slack-custom-ingress'
import { getSlackDispatchResponse } from '@/lib/webhooks/slack-dispatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Ingest endpoint for a reusable custom Slack bot. The bot's single Event
 * Subscriptions Request URL embeds its credential id, so every trigger that
 * references the same bot credential shares one URL — routed here by
 * `routingKey = credentialId` (mirrors the native `/api/webhooks/slack`
 * `team_id` fan-out). Requests are HMAC-verified with the credential's OWN
 * signing secret (not the shared env secret).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ credentialId: string }> }) => {
    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }
    try {
      return await handleSlackCustomBotWebhook(request, context)
    } finally {
      ticket.release()
    }
  }
)

async function handleSlackCustomBotWebhook(
  request: NextRequest,
  context: { params: Promise<{ credentialId: string }> }
): Promise<NextResponse> {
  const receivedAt = Date.now()
  const requestId = generateRequestId()
  const { credentialId } = await context.params

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }
  const { body, rawBody } = parseResult

  // Echo Slack's url_verification challenge unconditionally — this is how Slack
  // verifies the Request URL when the app is created from the manifest, before
  // the bot is installed / the credential is finalized.
  const challenge = handleSlackChallenge(body)
  if (challenge) {
    return challenge
  }

  const authError = await verifySlackCustomBotCredentialRequest({
    credentialId,
    request,
    rawBody,
    requestId,
  })
  if (authError) {
    return authError
  }

  const dispatchResults = await dispatchSlackCustomBotCredential({
    credentialId,
    body,
    request,
    requestId,
    receivedAt,
  })
  return getSlackDispatchResponse(dispatchResults)
}
