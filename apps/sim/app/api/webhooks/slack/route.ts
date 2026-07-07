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
import { type SlackEventFilter, slackEventSupportsFilter } from '@/triggers/slack/shared'

const logger = createLogger('SlackAppWebhookAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Message subtypes that carry real content (vs system/join/topic messages). */
const CONTENT_MESSAGE_SUBTYPES = new Set([
  'file_share',
  'me_message',
  'thread_broadcast',
  'bot_message',
])

/**
 * Maps an inbound Slack Events API payload to the trigger `eventType` id it
 * satisfies (see SLACK_EVENT_CATALOG). Returns null for payloads we do not
 * surface. For most events the Slack `event.type` is the id verbatim; `message`
 * fans out to `message` / `message_edited` / `message_deleted` by subtype.
 */
function resolveSlackEventKey(body: Record<string, unknown>): string | null {
  const event = body.event as Record<string, unknown> | undefined
  if (!event) return null
  const type = event.type as string | undefined

  switch (type) {
    case 'app_mention':
    case 'reaction_added':
    case 'reaction_removed':
    case 'file_shared':
    case 'member_joined_channel':
    case 'member_left_channel':
    case 'channel_created':
    case 'channel_archive':
    case 'channel_rename':
    case 'pin_added':
    case 'pin_removed':
    case 'team_join':
    case 'app_home_opened':
    case 'assistant_thread_started':
    case 'assistant_thread_context_changed':
      return type
    case 'message': {
      const subtype = event.subtype as string | undefined
      if (subtype === 'message_changed') return 'message_edited'
      if (subtype === 'message_deleted') return 'message_deleted'
      // Edits/deletes are handled above; other non-content subtypes (joins,
      // topic/name changes, etc.) are not surfaced. `bot_message` is content so
      // the "Ignore bot messages" toggle can decide, rather than being dropped.
      if (subtype && !CONTENT_MESSAGE_SUBTYPES.has(subtype)) return null
      return 'message'
    }
    default:
      return null
  }
}

/** True when the message originated from a bot (used to ignore other bots). */
function isBotMessage(event: Record<string, unknown> | undefined): boolean {
  if (!event) return false
  return Boolean(event.bot_id) || event.subtype === 'bot_message'
}

/**
 * True when the event was produced by this Slack app itself (its own message or
 * bot output), identified by matching the producing `app_id` against the
 * payload's `api_app_id`. Config-independent — used for the always-on self-drop.
 */
function isOwnAppEvent(
  event: Record<string, unknown> | undefined,
  apiAppId: string | undefined
): boolean {
  if (!event || !apiAppId) return false
  const appId =
    (event.app_id as string | undefined) ??
    ((event.bot_profile as Record<string, unknown> | undefined)?.app_id as string | undefined)
  return appId === apiAppId
}

/** True when the event is a thread reply (Slack-canonical: thread_ts set and != ts). */
function isThreadReply(event: Record<string, unknown> | undefined): boolean {
  if (!event) return false
  const threadTs = event.thread_ts as string | undefined
  const ts = event.ts as string | undefined
  return typeof threadTs === 'string' && threadTs.length > 0 && threadTs !== ts
}

function normalizeSelection(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((v) => v.trim())
  return []
}

/**
 * Back-compat matcher for pre-redesign webhooks that stored a multi-select
 * `events` array of old ids (`message.im`, `message.channels`, ...). Maps the
 * new `eventKey` back onto the legacy selection so existing deployments keep
 * firing until they are re-deployed onto the single-event model.
 */
function matchesLegacyEvents(
  rawEvents: unknown,
  eventKey: string | null,
  channelType: string | undefined
): boolean {
  const events = normalizeSelection(rawEvents)
  if (events.length === 0 || !eventKey) return false
  for (const legacy of events) {
    if (legacy === eventKey) return true
    if (eventKey === 'message') {
      if (legacy === 'message.im' && channelType === 'im') return true
      if (legacy === 'message.channels' && channelType === 'channel') return true
      if (legacy === 'message.groups' && channelType === 'group') return true
    }
  }
  return false
}

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

  const rawEvent = payload.event as Record<string, unknown> | undefined
  const eventKey = resolveSlackEventKey(payload)
  const apiAppId = typeof payload.api_app_id === 'string' ? payload.api_app_id : undefined
  const eventChannel = resolveSlackEventChannel(rawEvent)
  const channelType = rawEvent?.channel_type as string | undefined
  const reaction = rawEvent?.reaction as string | undefined
  const reactor = rawEvent?.user as string | undefined
  const isReply = isThreadReply(rawEvent)
  const isOwn = isOwnAppEvent(rawEvent, apiAppId)
  const isBot = isBotMessage(rawEvent)

  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const triggerTimestampMs = slackRequestTimestamp
    ? Number(slackRequestTimestamp) * 1000
    : undefined

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooks) {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const configuredEvent =
      typeof providerConfig.eventType === 'string' ? providerConfig.eventType : null

    // Match the single configured event. Pre-redesign webhooks fall back to the
    // legacy multi-select `events` array.
    if (configuredEvent) {
      if (!eventKey || eventKey !== configuredEvent) continue
    } else if (!matchesLegacyEvents(providerConfig.events, eventKey, channelType)) {
      continue
    }

    const supports = (filter: SlackEventFilter): boolean =>
      configuredEvent !== null && slackEventSupportsFilter(configuredEvent, filter)

    // Source filter — restrict a message event to any of DM / public / private
    // (multiselect by `channel_type`). Empty means any source.
    if (supports('source')) {
      const sources = normalizeSelection(providerConfig.source)
      if (sources.length > 0 && (!channelType || !sources.includes(channelType))) continue
    }

    // Threads filter — include / exclude / only.
    if (supports('threads')) {
      const threads =
        typeof providerConfig.threads === 'string' ? providerConfig.threads : 'include'
      if (threads === 'exclude' && isReply) continue
      if (threads === 'only' && !isReply) continue
    }

    // Emoji filter — restrict a reaction event to specific emoji names.
    if (supports('emoji')) {
      const emojis = normalizeSelection(providerConfig.emoji)
      if (emojis.length > 0 && (!reaction || !emojis.includes(reaction))) continue
    }

    // Name-contains filter — restrict channel_created to matching names.
    if (supports('name')) {
      const needle =
        typeof providerConfig.nameContains === 'string' ? providerConfig.nameContains.trim() : ''
      if (needle) {
        const channel = rawEvent?.channel as Record<string, unknown> | undefined
        const name = typeof channel?.name === 'string' ? channel.name : ''
        if (!name.includes(needle)) continue
      }
    }

    // Channel filter — picker (channelFilter) or manual IDs (manualChannelFilter),
    // the basic/advanced sides of one canonical field. Prefer the picker so a
    // stale manual value can't keep matching. DMs always skip it: a DM's channel
    // is a DM id that can't be picked, so a DM allowed by Source must not be
    // dropped by a channel filter meant for real channels.
    const channelScoped =
      channelType !== 'im' && (configuredEvent ? supports('channels') : Boolean(eventChannel))
    if (channelScoped) {
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

    // Self-drop (invariant): never fire on this app's own output unless the
    // advanced opt-in is set. Reactions identify self by the stored bot user id;
    // messages by app_id. Other bots are dropped by the "Ignore bot messages"
    // toggle, but never our own output.
    const includeOwn = providerConfig.includeOwnMessages === true
    let ownEvent = isOwn
    if (eventKey === 'reaction_added' || eventKey === 'reaction_removed') {
      const botUserId =
        typeof providerConfig.bot_user_id === 'string' ? providerConfig.bot_user_id : undefined
      ownEvent = Boolean(botUserId) && reactor === botUserId
    }
    if (ownEvent) {
      if (!includeOwn) continue
    } else if (isBot && providerConfig.filterBotMessages !== false) {
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
