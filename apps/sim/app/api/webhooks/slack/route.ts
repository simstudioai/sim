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
  resolveSlackEventChannel,
  verifySlackRequestSignature,
} from '@/lib/webhooks/providers/slack'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'
import { SLACK_CHANNEL_SCOPED_EVENTS } from '@/triggers/slack/shared'

const logger = createLogger('SlackAppWebhookAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Message subtypes that represent real content (vs edits/deletes/system events). */
const CONTENT_MESSAGE_SUBTYPES = new Set(['file_share', 'me_message', 'thread_broadcast'])

/**
 * Maps an inbound Slack Events API payload to one of the selectable trigger
 * event ids (see SLACK_TRIGGER_EVENT_OPTIONS). Returns null for payloads we do
 * not surface as trigger operations.
 */
function resolveSlackEventKey(body: Record<string, unknown>): string | null {
  const event = body.event as Record<string, unknown> | undefined
  if (!event) return null
  const type = event.type as string | undefined

  if (type === 'app_mention') return 'app_mention'
  if (type === 'reaction_added') return 'reaction_added'
  if (type === 'reaction_removed') return 'reaction_removed'

  if (type === 'message') {
    // Only genuine new messages trigger. Edits, deletes, and channel system
    // messages (joins, topic/name changes, etc.) arrive as `message` with a
    // subtype — ignore all but content subtypes.
    const subtype = event.subtype as string | undefined
    if (subtype && !CONTENT_MESSAGE_SUBTYPES.has(subtype)) {
      return null
    }
    switch (event.channel_type as string | undefined) {
      case 'im':
        return 'message.im'
      case 'channel':
        return 'message.channels'
      case 'group':
        return 'message.groups'
      default:
        return null
    }
  }

  return null
}

/** True when the message originated from a bot (used to break agent loops). */
function isBotMessage(body: Record<string, unknown>): boolean {
  const event = body.event as Record<string, unknown> | undefined
  if (!event) return false
  return Boolean(event.bot_id) || event.subtype === 'bot_message'
}

function normalizeSelection(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((v) => v.trim())
  return []
}

/**
 * Single ingest endpoint for the official Sim Slack app. Every workspace's
 * events arrive here and are routed to listening workflows by Slack `team_id`
 * after HMAC verification with the shared app signing secret. This is the
 * request URL configured in the app's Event Subscriptions.
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
  const teamId =
    typeof payload.team_id === 'string' && payload.team_id.length > 0 ? payload.team_id : null
  if (!teamId) {
    logger.warn(`[${requestId}] Slack event missing team_id`)
    return new NextResponse(null, { status: 200 })
  }

  const webhooks = await findWebhooksByRoutingKey(teamId, requestId)
  if (webhooks.length === 0) {
    return new NextResponse(null, { status: 200 })
  }

  const eventKey = resolveSlackEventKey(payload)
  const eventChannel = resolveSlackEventChannel(
    payload.event as Record<string, unknown> | undefined
  )
  const isBot = isBotMessage(payload)
  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const triggerTimestampMs = slackRequestTimestamp
    ? Number(slackRequestTimestamp) * 1000
    : undefined

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooks) {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}

    // Fire only for events that map to a selected Operation. Unmapped events
    // (e.g. assistant_thread_*), unselected events, and an empty selection all
    // no-op — never bypass the filter.
    const selectedEvents = normalizeSelection(providerConfig.events)
    if (!eventKey || !selectedEvents.includes(eventKey)) {
      continue
    }

    // Channel filter applies only to channel-scoped events, never to DMs.
    // Channels come from the picker (channelFilter) or manual IDs
    // (manualChannelFilter) — the basic/advanced sides of one canonical field.
    // Prefer the picker when set so a stale manual value can't keep matching.
    if (eventKey && SLACK_CHANNEL_SCOPED_EVENTS.has(eventKey)) {
      const pickerChannels = normalizeSelection(providerConfig.channelFilter)
      const selectedChannels =
        pickerChannels.length > 0
          ? pickerChannels
          : normalizeSelection(providerConfig.manualChannelFilter)
      if (
        selectedChannels.length > 0 &&
        (!eventChannel || !selectedChannels.includes(eventChannel))
      ) {
        continue
      }
    }

    if (isBot && providerConfig.filterBotMessages !== false) {
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
