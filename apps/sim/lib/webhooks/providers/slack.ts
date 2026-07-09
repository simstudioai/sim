import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Slack')

const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const SLACK_MAX_FILES = 15

const SLACK_REACTION_EVENTS = new Set(['reaction_added', 'reaction_removed'])

/**
 * Interactivity payload types Slack POSTs to the request URL as a form-encoded
 * `payload` field (button clicks, selects, shortcuts, modal submits). These have
 * no Events-API `event` envelope, so they need their own mapping.
 * See https://api.slack.com/interactivity/handling#payloads
 */
const SLACK_INTERACTIVE_TYPES = new Set([
  'block_actions',
  'interactive_message',
  'message_action',
  'shortcut',
  'view_submission',
  'view_closed',
  'block_suggestion',
])

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
  // Prefer the source message text; fall back to the triggering action's value
  // so a blocks-only message still surfaces something useful in `text`.
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
 * Validate Slack request signature using HMAC-SHA256.
 * Basestring format: `v0:{timestamp}:{rawBody}`
 * Signature header format: `v0={hex}`
 */
function validateSlackSignature(
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

export const slackHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret) {
      return null
    }

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
      logger.warn(`[${requestId}] Slack webhook timestamp too old`, {
        timestamp,
        now,
        skew,
      })
      return new NextResponse('Unauthorized - Request timestamp too old', { status: 401 })
    }

    if (!validateSlackSignature(signingSecret, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Slack signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Slack signature', { status: 401 })
    }

    return null
  },

  handleChallenge(body: unknown) {
    return handleSlackChallenge(body)
  },

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

    // Interactivity and slash-command payloads carry a unique `trigger_id`
    // per interaction, which Slack reuses across retries of the same payload.
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

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const botToken = providerConfig.botToken as string | undefined
    const includeFiles = Boolean(providerConfig.includeFiles)

    // Slash commands: flat form fields identified by a leading-slash `command`.
    if (typeof b?.command === 'string' && b.command.startsWith('/')) {
      return { input: { event: formatSlackSlashCommand(b) } }
    }

    // Interactivity (button clicks, selects, shortcuts, modal submits): a JSON
    // `payload` with an interactive `type` and no Events-API `event` envelope.
    if (
      !b?.event &&
      ((typeof b?.type === 'string' && SLACK_INTERACTIVE_TYPES.has(b.type)) ||
        Array.isArray(b?.actions))
    ) {
      return { input: { event: formatSlackInteractive(b) } }
    }

    // Events API (app_mention, message, reaction_added, ...).
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
    const channel: string = isReactionEvent
      ? (item?.channel as string) || ''
      : (rawEvent?.channel as string) || ''
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
    event.reaction = asString(rawEvent?.reaction)
    event.item_user = asString(rawEvent?.item_user)
    event.message_ts = messageTs
    event.hasFiles = hasFiles
    event.files = files

    return { input: { event } }
  },
}
