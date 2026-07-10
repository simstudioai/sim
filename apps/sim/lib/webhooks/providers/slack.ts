import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  getSlackBotCredential,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'
import { type SlackEventFilter, slackEventSupportsFilter } from '@/triggers/slack/shared'

const logger = createLogger('WebhookProvider:Slack')

/** 50 MB */
const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024
const SLACK_MAX_FILES = 15

const SLACK_REACTION_EVENTS = new Set(['reaction_added', 'reaction_removed'])

/**
 * Interactivity payload types Slack POSTs to the request URL as a form-encoded
 * `payload` field (button clicks, selects, shortcuts, modal submits). These have
 * no Events-API `event` envelope, so they need their own mapping.
 * See https://api.slack.com/interactivity/handling#payloads
 *
 * `block_suggestion` (external select option loading) is deliberately excluded:
 * Slack requires a synchronous JSON `options` response within 3 seconds, which
 * this trigger's fire-and-forget webhook execution model cannot provide — it is
 * skipped explicitly in `formatInput` instead of being routed here.
 */
const SLACK_INTERACTIVE_TYPES = new Set([
  'block_actions',
  'interactive_message',
  'message_action',
  'shortcut',
  'view_submission',
  'view_closed',
])

/**
 * Interaction payload types surfaced as selectable trigger events. A subset of
 * SLACK_INTERACTIVE_TYPES — these are the only interactions that map to an
 * eventType a trigger can subscribe to (see SLACK_EVENT_CATALOG).
 */
const SLACK_INTERACTION_EVENT_KEYS = new Set(['block_actions', 'view_submission'])

interface SlackDownloadedFile {
  name: string
  data: string
  mimeType: string
  size: number
}

/**
 * Unified output shape for the Slack trigger across all three payload families
 * (Events API, interactivity, slash commands). Every key is always present so
 * downstream blocks never resolve to `undefined`.
 */
interface SlackTriggerEvent {
  event_type: string
  subtype: string
  channel: string
  channel_name: string
  channel_type: string
  user: string
  user_name: string
  bot_id: string
  text: string
  timestamp: string
  thread_ts: string
  team_id: string
  event_id: string
  reaction: string
  item_user: string
  command: string
  action_id: string
  action_value: string
  actions: unknown[]
  response_url: string
  trigger_id: string
  callback_id: string
  api_app_id: string
  app_id: string
  message_ts: string
  /**
   * Full Slack view object for modal interactions (view_submission/view_closed):
   * `state.values` (submitted input values), `private_metadata`, `id`,
   * `callback_id`, `hash`, etc. Null for non-modal interactions and Events API.
   */
  view: Record<string, unknown> | null
  /**
   * Full Slack message object the interaction originated from (block_actions):
   * `blocks`, `text`, `ts`, etc. — needed to rewrite the source message's blocks.
   * Null when the interaction has no source message and for slash/Events API.
   */
  message: Record<string, unknown> | null
  /**
   * Top-level interactivity `state` for block_actions: the current values of all
   * stateful elements in the surface (`state.values`), e.g. inputs read on a
   * button click without a modal submit. Distinct from `view.state` (modal
   * submissions). Null for non-block_actions payloads.
   */
  state: Record<string, unknown> | null
  hasFiles: boolean
  files: SlackDownloadedFile[]
}

function createSlackEvent(): SlackTriggerEvent {
  return {
    event_type: 'unknown',
    subtype: '',
    channel: '',
    channel_name: '',
    channel_type: '',
    user: '',
    user_name: '',
    bot_id: '',
    text: '',
    timestamp: '',
    thread_ts: '',
    team_id: '',
    event_id: '',
    reaction: '',
    item_user: '',
    command: '',
    action_id: '',
    action_value: '',
    actions: [],
    response_url: '',
    trigger_id: '',
    callback_id: '',
    api_app_id: '',
    app_id: '',
    message_ts: '',
    view: null,
    message: null,
    state: null,
    hasFiles: false,
    files: [],
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Normalize the "value" carried by a Slack interactive action across the
 * different element types (button, static/multi/external select, datepicker,
 * timepicker, overflow, radio/checkbox, conversations/channels/users select).
 */
function extractActionValue(action: Record<string, unknown> | undefined): string {
  if (!action) return ''
  if (typeof action.value === 'string') return action.value

  const selectedOption = action.selected_option as Record<string, unknown> | undefined
  if (selectedOption && typeof selectedOption.value === 'string') {
    return selectedOption.value
  }

  const selectedOptions = action.selected_options as Array<Record<string, unknown>> | undefined
  if (Array.isArray(selectedOptions)) {
    return selectedOptions
      .map((o) => (typeof o?.value === 'string' ? o.value : ''))
      .filter(Boolean)
      .join(',')
  }

  for (const key of [
    'selected_date',
    'selected_time',
    'selected_date_time',
    'selected_conversation',
    'selected_channel',
    'selected_user',
  ] as const) {
    if (typeof action[key] === 'string') {
      return action[key] as string
    }
  }

  return ''
}

/**
 * Slash commands arrive as flat `application/x-www-form-urlencoded` fields
 * (no JSON `payload`, no `event` envelope), identified by a leading-slash
 * `command`. See https://api.slack.com/interactivity/slash-commands
 */
function formatSlackSlashCommand(b: Record<string, unknown>): SlackTriggerEvent {
  const event = createSlackEvent()
  event.event_type = 'slash_command'
  event.command = asString(b.command)
  event.text = asString(b.text)
  event.channel = asString(b.channel_id)
  event.channel_name = asString(b.channel_name)
  event.user = asString(b.user_id)
  event.user_name = asString(b.user_name)
  event.team_id = asString(b.team_id)
  event.response_url = asString(b.response_url)
  event.trigger_id = asString(b.trigger_id)
  event.api_app_id = asString(b.api_app_id)
  return event
}

/**
 * Interactivity payloads (button clicks, selects, shortcuts, modal submits).
 * The actionable data lives in `actions[]` / `view`, plus `response_url` and
 * `trigger_id` which are needed to respond to or follow up on the interaction.
 * `text` prefers the source message text, falling back to the triggering
 * action's value so a blocks-only message still surfaces something useful.
 */
function formatSlackInteractive(b: Record<string, unknown>): SlackTriggerEvent {
  const event = createSlackEvent()
  event.event_type = asString(b.type) || 'block_actions'

  const actions = Array.isArray(b.actions) ? (b.actions as Array<Record<string, unknown>>) : []
  event.actions = actions
  const firstAction = actions[0]
  event.action_id = asString(firstAction?.action_id)
  event.action_value = extractActionValue(firstAction)

  const channel = b.channel as Record<string, unknown> | undefined
  event.channel = asString(channel?.id)
  event.channel_name = asString(channel?.name)

  const user = b.user as Record<string, unknown> | undefined
  event.user = asString(user?.id)
  event.user_name = asString(user?.username) || asString(user?.name)

  const team = b.team as Record<string, unknown> | undefined
  event.team_id = asString(team?.id) || asString(user?.team_id)

  const container = b.container as Record<string, unknown> | undefined
  const message = b.message as Record<string, unknown> | undefined
  event.message_ts = asString(message?.ts) || asString(container?.message_ts)
  event.timestamp = event.message_ts || asString(firstAction?.action_ts)
  event.thread_ts = asString(message?.thread_ts)
  event.text = asString(message?.text) || event.action_value
  event.message = message ?? null

  event.response_url = asString(b.response_url)
  event.trigger_id = asString(b.trigger_id)
  const view = b.view as Record<string, unknown> | undefined
  event.callback_id = asString(b.callback_id) || asString(view?.callback_id)
  event.view = view ?? null
  event.state = (b.state as Record<string, unknown>) ?? null
  event.api_app_id = asString(b.api_app_id)

  return event
}

async function resolveSlackFileInfo(
  fileId: string,
  botToken: string
): Promise<{ url_private?: string; name?: string; mimetype?: string; size?: number } | null> {
  try {
    const response = await fetch(
      `https://slack.com/api/files.info?file=${encodeURIComponent(fileId)}`,
      { headers: { Authorization: `Bearer ${botToken}` } }
    )
    const data = (await response.json()) as {
      ok: boolean
      error?: string
      file?: Record<string, unknown>
    }
    if (!data.ok || !data.file) {
      logger.warn('Slack files.info failed', { fileId, error: data.error })
      return null
    }
    return {
      url_private: data.file.url_private as string | undefined,
      name: data.file.name as string | undefined,
      mimetype: data.file.mimetype as string | undefined,
      size: data.file.size as number | undefined,
    }
  } catch (error) {
    logger.error('Error calling Slack files.info', {
      fileId,
      error: toError(error).message,
    })
    return null
  }
}

async function downloadSlackFiles(
  rawFiles: unknown[],
  botToken: string
): Promise<Array<{ name: string; data: string; mimeType: string; size: number }>> {
  const filesToProcess = rawFiles.slice(0, SLACK_MAX_FILES)
  const downloaded: Array<{ name: string; data: string; mimeType: string; size: number }> = []

  for (const file of filesToProcess) {
    const f = file as Record<string, unknown>
    let urlPrivate = f.url_private as string | undefined
    let fileName = f.name as string | undefined
    let fileMimeType = f.mimetype as string | undefined
    let fileSize = f.size as number | undefined

    if (!urlPrivate && f.id) {
      const resolved = await resolveSlackFileInfo(f.id as string, botToken)
      if (resolved?.url_private) {
        urlPrivate = resolved.url_private
        fileName = fileName || resolved.name
        fileMimeType = fileMimeType || resolved.mimetype
        fileSize = fileSize ?? resolved.size
      }
    }

    if (!urlPrivate) {
      logger.warn('Slack file has no url_private and could not be resolved, skipping', {
        fileId: f.id,
      })
      continue
    }

    const reportedSize = Number(fileSize) || 0
    if (reportedSize > SLACK_MAX_FILE_SIZE) {
      logger.warn('Slack file exceeds size limit, skipping', {
        fileId: f.id,
        size: reportedSize,
        limit: SLACK_MAX_FILE_SIZE,
      })
      continue
    }

    try {
      const urlValidation = await validateUrlWithDNS(urlPrivate, 'url_private')
      if (!urlValidation.isValid) {
        logger.warn('Slack file url_private failed DNS validation, skipping', {
          fileId: f.id,
          error: urlValidation.error,
        })
        continue
      }

      const response = await secureFetchWithPinnedIP(urlPrivate, urlValidation.resolvedIP!, {
        headers: { Authorization: `Bearer ${botToken}` },
      })

      if (!response.ok) {
        logger.warn('Failed to download Slack file, skipping', {
          fileId: f.id,
          status: response.status,
        })
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (buffer.length > SLACK_MAX_FILE_SIZE) {
        logger.warn('Downloaded Slack file exceeds size limit, skipping', {
          fileId: f.id,
          actualSize: buffer.length,
          limit: SLACK_MAX_FILE_SIZE,
        })
        continue
      }

      downloaded.push({
        name: fileName || 'download',
        data: buffer.toString('base64'),
        mimeType: fileMimeType || 'application/octet-stream',
        size: buffer.length,
      })
    } catch (error) {
      logger.error('Error downloading Slack file, skipping', {
        fileId: f.id,
        error: toError(error).message,
      })
    }
  }

  return downloaded
}

async function fetchSlackMessageText(
  channel: string,
  messageTs: string,
  botToken: string
): Promise<string> {
  try {
    const params = new URLSearchParams({ channel, timestamp: messageTs })
    const response = await fetch(`https://slack.com/api/reactions.get?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const data = (await response.json()) as {
      ok: boolean
      error?: string
      type?: string
      message?: { text?: string }
    }
    if (!data.ok) {
      logger.warn('Slack reactions.get failed — message text unavailable', {
        channel,
        messageTs,
        error: data.error,
      })
      return ''
    }
    return data.message?.text ?? ''
  } catch (error) {
    logger.warn('Error fetching Slack message text', {
      channel,
      messageTs,
      error: toError(error).message,
    })
    return ''
  }
}

/** Maximum allowed timestamp skew (5 minutes) per Slack docs. */
const SLACK_TIMESTAMP_MAX_SKEW = 300

/**
 * Resolve the Slack `team_id` and bot `user_id` for a bot token via `auth.test`.
 * Used at deploy time to derive the tenant routing key for the native
 * (`slack_app`) trigger and to store the bot user id for reaction self-drop —
 * both are Slack-attested, never taken from user input. Throws on failure so
 * deploy fails fast rather than registering an unroutable trigger.
 */
export async function fetchSlackTeamId(botToken: string): Promise<{
  teamId: string
  userId: string | undefined
  teamName: string | undefined
}> {
  const response = await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${botToken}` },
  })
  const data = (await response.json()) as {
    ok?: boolean
    team_id?: string
    user_id?: string
    team?: string
    error?: string
  }
  if (!data.ok || !data.team_id) {
    throw new Error(`Slack auth.test failed: ${data.error || 'unknown error'}`)
  }
  return { teamId: data.team_id, userId: data.user_id, teamName: data.team }
}

/**
 * Validate Slack request signature using HMAC-SHA256.
 * Basestring format: `v0:{timestamp}:{rawBody}`
 * Signature header format: `v0={hex}`
 */
export function validateSlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean {
  try {
    if (!signingSecret || !signature || !rawBody) {
      return false
    }

    if (!signature.startsWith('v0=')) {
      logger.warn('Slack signature has invalid format (missing v0= prefix)')
      return false
    }

    const providedSignature = signature.substring(3)
    const basestring = `v0:${timestamp}:${rawBody}`
    const computedHash = hmacSha256Hex(basestring, signingSecret)

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Slack signature:', error)
    return false
  }
}

/**
 * Channel a Slack event occurred in. Message/mention events carry it under
 * `channel`, reaction events under `item.channel`, and file/pin events under
 * `channel_id`.
 */
export function resolveSlackEventChannel(
  event: Record<string, unknown> | undefined
): string | undefined {
  if (!event) return undefined
  if (typeof event.channel === 'string') return event.channel
  const item = event.item as Record<string, unknown> | undefined
  if (typeof item?.channel === 'string') return item.channel
  return typeof event.channel_id === 'string' ? event.channel_id : undefined
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: unknown): NextResponse | null {
  if (!isRecordLike(body)) {
    return null
  }

  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  return null
}

/**
 * Verify a Slack request's timestamp + HMAC signature against a signing secret.
 * Returns a 401 `NextResponse` on failure, or `null` when valid. Shared by the
 * per-workflow webhook handler (secret from providerConfig) and the native app
 * ingest route (secret from `SLACK_SIGNING_SECRET`).
 */
export function verifySlackRequestSignature(
  signingSecret: string,
  request: Request,
  rawBody: string,
  requestId: string
): NextResponse | null {
  const signature = request.headers.get('x-slack-signature')
  const timestamp = request.headers.get('x-slack-request-timestamp')

  if (!signature || !timestamp) {
    logger.warn(`[${requestId}] Slack webhook missing signature or timestamp header`)
    return new NextResponse('Unauthorized - Missing Slack signature', { status: 401 })
  }

  const now = Math.floor(Date.now() / 1000)
  const parsedTimestamp = Number(timestamp)
  if (Number.isNaN(parsedTimestamp)) {
    logger.warn(`[${requestId}] Slack webhook timestamp is not a valid number`, { timestamp })
    return new NextResponse('Unauthorized - Invalid timestamp', { status: 401 })
  }
  const skew = Math.abs(now - parsedTimestamp)
  if (skew > SLACK_TIMESTAMP_MAX_SKEW) {
    logger.warn(`[${requestId}] Slack webhook timestamp too old`, { timestamp, now, skew })
    return new NextResponse('Unauthorized - Request timestamp too old', { status: 401 })
  }

  if (!validateSlackSignature(signingSecret, signature, timestamp, rawBody)) {
    logger.warn(`[${requestId}] Slack signature verification failed`)
    return new NextResponse('Unauthorized - Invalid Slack signature', { status: 401 })
  }

  return null
}

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
export function resolveSlackEventKey(body: Record<string, unknown>): string | null {
  const event = body.event as Record<string, unknown> | undefined
  if (!event) {
    // Interactivity payloads (button clicks, modal submits) have no `event`
    // envelope — the family is the top-level `type`. Surface only the ones a
    // trigger can subscribe to.
    const interactionType = body.type as string | undefined
    if (interactionType && SLACK_INTERACTION_EVENT_KEYS.has(interactionType)) {
      return interactionType
    }
    return null
  }
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
function isBotEvent(event: Record<string, unknown> | undefined): boolean {
  if (!event) return false
  return Boolean(event.bot_id) || event.subtype === 'bot_message'
}

/**
 * True when the event was produced by this Slack app itself, identified by
 * matching the producing `app_id` against the payload's `api_app_id`.
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
 * Decides whether an inbound Slack event should be dropped for a `slack_oauth`
 * trigger webhook, applying the configured event, source, threads, emoji, name,
 * channel, self-drop, and bot filters. Shared by the native app ingest route
 * (`/api/webhooks/slack`) and the custom-app path route (via
 * `slackHandler.shouldSkipEvent`) so both backends filter identically. Returns
 * true to skip.
 */
export function shouldSkipSlackTriggerEvent(
  body: Record<string, unknown>,
  providerConfig: Record<string, unknown>
): boolean {
  const rawEvent = body.event as Record<string, unknown> | undefined
  const eventKey = resolveSlackEventKey(body)
  const channelType = rawEvent?.channel_type as string | undefined
  const configuredEvent =
    typeof providerConfig.eventType === 'string' ? providerConfig.eventType : null

  // Match the single configured event. Pre-redesign webhooks fall back to the
  // legacy multi-select `events` array.
  if (configuredEvent) {
    if (!eventKey || eventKey !== configuredEvent) return true
  } else if (!matchesLegacyEvents(providerConfig.events, eventKey, channelType)) {
    return true
  }

  const supports = (filter: SlackEventFilter): boolean =>
    configuredEvent !== null && slackEventSupportsFilter(configuredEvent, filter)

  // Source — restrict a message event to any of DM / public / private
  // (multiselect by `channel_type`). Empty means any source. Only filter when
  // the channel_type is actually known: `message_changed` / `message_deleted`
  // payloads often omit it, and dropping those on an unknown type would silently
  // swallow every edit/delete.
  if (supports('source')) {
    const sources = normalizeSelection(providerConfig.source)
    if (sources.length > 0 && channelType && !sources.includes(channelType)) return true
  }

  // Threads — include / exclude / only.
  if (supports('threads')) {
    const threads = typeof providerConfig.threads === 'string' ? providerConfig.threads : 'include'
    const reply = isThreadReply(rawEvent)
    if (threads === 'exclude' && reply) return true
    if (threads === 'only' && !reply) return true
  }

  // Emoji — restrict a reaction event to specific emoji names.
  if (supports('emoji')) {
    const emojis = normalizeSelection(providerConfig.emoji)
    const reaction = rawEvent?.reaction as string | undefined
    if (emojis.length > 0 && (!reaction || !emojis.includes(reaction))) return true
  }

  // Name-contains — restrict channel_created to matching names.
  if (supports('name')) {
    const needle =
      typeof providerConfig.nameContains === 'string' ? providerConfig.nameContains.trim() : ''
    if (needle) {
      const channel = rawEvent?.channel as Record<string, unknown> | undefined
      const name = typeof channel?.name === 'string' ? channel.name : ''
      if (!name.includes(needle)) return true
    }
  }

  // Interaction — restrict a block_actions / view_submission event to specific
  // action_id / callback_id values. Interaction fields live on the top-level
  // body, not `rawEvent` (which is undefined for interactions). Empty = any.
  if (supports('interaction')) {
    const ids = normalizeSelection(providerConfig.interactionFilter)
    if (ids.length > 0) {
      const actions = Array.isArray(body.actions)
        ? (body.actions as Array<Record<string, unknown>>)
        : []
      const view = body.view as Record<string, unknown> | undefined
      const interactionId =
        eventKey === 'view_submission'
          ? ((view?.callback_id as string | undefined) ?? (body.callback_id as string | undefined))
          : (actions[0]?.action_id as string | undefined)
      if (!interactionId || !ids.includes(interactionId)) return true
    }
  }

  // Channels — picker or manual IDs, the basic/advanced sides of one canonical
  // field. DMs always skip it: a DM's channel can't be picked, so a DM allowed
  // by Source must not be dropped by a channel filter meant for real channels.
  const eventChannel = resolveSlackEventChannel(rawEvent)
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
      return true
    }
  }

  // Self-drop (invariant): never fire on this app's own output unless the
  // advanced opt-in is set. Reactions identify self by the stored bot user id,
  // messages by app_id. Other bots are dropped by the "Ignore bot messages"
  // toggle, but never our own output.
  const includeOwn = providerConfig.includeOwnMessages === true
  let ownEvent = isOwnAppEvent(
    rawEvent,
    typeof body.api_app_id === 'string' ? body.api_app_id : undefined
  )
  if (eventKey === 'reaction_added' || eventKey === 'reaction_removed') {
    const botUserId =
      typeof providerConfig.bot_user_id === 'string' ? providerConfig.bot_user_id : undefined
    ownEvent = Boolean(botUserId) && (rawEvent?.user as string | undefined) === botUserId
  }
  if (ownEvent) {
    if (!includeOwn) return true
  } else if (isBotEvent(rawEvent) && providerConfig.filterBotMessages !== false) {
    return true
  }

  return false
}

export const slackHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret) {
      return null
    }
    return verifySlackRequestSignature(signingSecret, request, rawBody, requestId)
  },

  handleChallenge(body: unknown) {
    return handleSlackChallenge(body)
  },

  shouldSkipEvent({ body, providerConfig }: EventFilterContext) {
    // Only the unified `slack_oauth` trigger carries event/filter config on this
    // (custom-app) path; the legacy `slack_webhook` trigger is unfiltered.
    if (providerConfig.triggerId !== 'slack_oauth') return false
    return shouldSkipSlackTriggerEvent(body as Record<string, unknown>, providerConfig)
  },

  /**
   * `event_id` (Events API) and `team_id:event.ts` are the primary keys.
   * `trigger_id` is the fallback for interactivity and slash-command payloads,
   * which carry no `event_id` but reuse the same `trigger_id` across Slack's
   * retries of a given interaction.
   */
  extractIdempotencyId(body: unknown) {
    if (!isRecordLike(body)) {
      return null
    }

    if (body.event_id) {
      return String(body.event_id)
    }

    const event = isRecordLike(body.event) ? body.event : undefined
    if (event?.ts && body.team_id) {
      return `${body.team_id}:${event.ts}`
    }

    if (body.trigger_id) {
      return String(body.trigger_id)
    }

    return null
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  formatQueueErrorResponse() {
    return new NextResponse(null, { status: 200 })
  },

  /**
   * Routes across Slack's three distinct payload families, each identified by
   * a different shape: slash commands (flat form fields with a leading-slash
   * `command`), interactivity (a JSON `payload` with an interactive `type` or
   * `actions[]` and no Events-API `event` envelope), and the Events API
   * (app_mention, message, reaction_added, ... nested under `event`).
   */
  async formatInput({ body, webhook, requestId }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    let botToken = providerConfig.botToken as string | undefined
    // Reusable custom Slack bot credential: use its stored bot token directly.
    if (!botToken && typeof providerConfig.credentialId === 'string') {
      const botCredential = await getSlackBotCredential(providerConfig.credentialId)
      if (botCredential) botToken = botCredential.botToken
    }
    // Native (slack_app) triggers carry an OAuth credential rather than a pasted
    // bot token; resolve it via the credential's OWNER (not the execution actor
    // in workflow.userId, who may not own the credential) so reaction-message
    // text and file downloads work.
    if (!botToken && typeof providerConfig.credentialId === 'string') {
      const credentialId = providerConfig.credentialId
      const resolved = await resolveOAuthAccountId(credentialId)
      if (resolved?.accountId) {
        const [owner] = await db
          .select({ userId: account.userId })
          .from(account)
          .where(eq(account.id, resolved.accountId))
          .limit(1)
        if (owner?.userId) {
          botToken =
            (await refreshAccessTokenIfNeeded(credentialId, owner.userId, requestId)) ?? undefined
        }
      }
    }
    const includeFiles = Boolean(providerConfig.includeFiles)

    if (typeof b?.command === 'string' && b.command.startsWith('/')) {
      return { input: { event: formatSlackSlashCommand(b) } }
    }

    if (b?.type === 'block_suggestion') {
      return {
        input: null,
        skip: {
          message:
            'Slack block_suggestion payloads require a synchronous options response and cannot be served by an async workflow trigger',
        },
      }
    }

    if (
      !b?.event &&
      ((typeof b?.type === 'string' && SLACK_INTERACTIVE_TYPES.has(b.type)) ||
        Array.isArray(b?.actions))
    ) {
      return { input: { event: formatSlackInteractive(b) } }
    }

    const rawEvent = b?.event as Record<string, unknown> | undefined

    if (!rawEvent) {
      logger.warn('Unknown Slack event type', {
        type: b?.type,
        hasEvent: false,
        bodyKeys: Object.keys(b || {}),
      })
    }

    const eventType: string = (rawEvent?.type as string) || (b?.type as string) || 'unknown'
    const isReactionEvent = SLACK_REACTION_EVENTS.has(eventType)

    const item = rawEvent?.item as Record<string, unknown> | undefined
    const channel: string = resolveSlackEventChannel(rawEvent) || ''
    const messageTs: string = isReactionEvent
      ? (item?.ts as string) || ''
      : (rawEvent?.ts as string) || (rawEvent?.event_ts as string) || ''

    let text: string = (rawEvent?.text as string) || ''
    if (isReactionEvent && channel && messageTs && botToken) {
      text = await fetchSlackMessageText(channel, messageTs, botToken)
    }

    const rawFiles: unknown[] = (rawEvent?.files as unknown[]) ?? []
    const hasFiles = rawFiles.length > 0

    let files: SlackDownloadedFile[] = []
    if (hasFiles && includeFiles && botToken) {
      files = await downloadSlackFiles(rawFiles, botToken)
    } else if (hasFiles && includeFiles && !botToken) {
      logger.warn('Slack message has files and includeFiles is enabled, but no bot token provided')
    }

    const event = createSlackEvent()
    event.event_type = eventType
    event.subtype = asString(rawEvent?.subtype)
    event.channel = channel
    event.channel_type = asString(rawEvent?.channel_type)
    event.user = asString(rawEvent?.user)
    event.bot_id = asString(rawEvent?.bot_id)
    event.text = text
    event.timestamp = messageTs
    event.thread_ts = asString(rawEvent?.thread_ts)
    event.team_id = asString(b?.team_id) || asString(rawEvent?.team)
    event.event_id = asString(b?.event_id)
    event.api_app_id = asString(b?.api_app_id)
    event.app_id =
      asString(rawEvent?.app_id) ||
      asString((rawEvent?.bot_profile as Record<string, unknown> | undefined)?.app_id)
    event.reaction = asString(rawEvent?.reaction)
    event.item_user = asString(rawEvent?.item_user)
    event.message_ts = messageTs
    event.hasFiles = hasFiles
    event.files = files

    return { input: { event } }
  },
}
