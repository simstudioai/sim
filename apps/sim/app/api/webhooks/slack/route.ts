import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveSlackAppInstallation } from '@/lib/knowledge/application/slack-search/ingress'
import { loadSlackAppConfiguration } from '@/lib/slack-search/app-configuration'
import { dispatchSlackSearch } from '@/lib/slack-search/dispatcher'
import { findWebhooksByRoutingKey, parseWebhookBody } from '@/lib/webhooks/processor'
import { handleSlackChallenge, verifySlackRequestSignature } from '@/lib/webhooks/providers/slack'
import {
  dispatchSlackCustomBotCredential,
  handleSlackAgentSessionStopped,
} from '@/lib/webhooks/slack-custom-ingress'
import { dispatchSlackWebhooks, getSlackDispatchResponse } from '@/lib/webhooks/slack-dispatch'

const logger = createLogger('SlackAppWebhookAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Shared ingest for registered custom and platform apps. The untrusted app ID
 * selects exactly one signing key; routing occurs only after raw-body verification.
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

  /** Manifest creation precedes credential registration; challenge echo never dispatches work. */
  const challenge = handleSlackChallenge(body)
  if (challenge) return challenge
  if (!isRecordLike(body)) return new NextResponse('Invalid Slack payload', { status: 400 })
  const payload = body
  const appId = payload.api_app_id
  if (typeof appId !== 'string' || !/^A[A-Z0-9]{1,199}$/.test(appId))
    return new NextResponse('Missing Slack app identity', { status: 400 })
  const configuration = await loadSlackAppConfiguration(appId)
  if (!configuration) return new NextResponse('Unknown Slack app', { status: 401 })

  const authError = verifySlackRequestSignature(
    configuration.signingSecret,
    request,
    rawBody,
    requestId
  )
  if (authError) {
    return authError
  }

  const interactionTeam = payload.team as { id?: unknown } | undefined
  const searchTeamId = typeof payload.team_id === 'string' ? payload.team_id : interactionTeam?.id
  const searchInstallation =
    typeof searchTeamId === 'string'
      ? await resolveSlackAppInstallation.execute({
          principal: {
            kind: 'slack_app',
            appId,
            appRevision: configuration.app.revision,
            receivedAt: new Date(receivedAt),
          },
          input: { teamId: searchTeamId },
        })
      : null
  if (searchInstallation) {
    await Promise.all([
      dispatchSlackSearch({ ...searchInstallation, body, receivedAt }),
      handleSlackAgentSessionStopped(searchInstallation.credentialId, body),
    ])
  }
  if (configuration.app.kind === 'custom') {
    if (!searchInstallation) return new NextResponse(null, { status: 200 })
    return getSlackDispatchResponse(
      await dispatchSlackCustomBotCredential({
        credentialId: searchInstallation.credentialId,
        body,
        request,
        requestId,
        receivedAt,
      })
    )
  }

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

  const webhooksById = new Map<
    string,
    Awaited<ReturnType<typeof findWebhooksByRoutingKey>>[number]
  >()
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

  const dispatchResults = await dispatchSlackWebhooks(webhooks, {
    body,
    request,
    requestId,
    receivedAt,
  })
  return getSlackDispatchResponse(dispatchResults)
}
