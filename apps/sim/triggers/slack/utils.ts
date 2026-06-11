/**
 * Runtime classification and filtering for the Slack v2 trigger
 * (`slack_webhook_v2`).
 *
 * @remarks
 * Everything here is deterministic: decisions are made only from Slack payload
 * fields, the app's own identity (event envelope `authorizations` /
 * `api_app_id`, or a cached `auth.test`), and the trigger configuration.
 * No text heuristics beyond exact containment of the authoritative bot user id
 * (the explicit, opt-out mention-overlap guard).
 *
 * Kept free of server-only imports so it can be unit-tested and dynamically
 * imported from the webhook provider (same pattern as `triggers/github/utils`).
 */

import { normalizeSlashCommand, SLACK_CAPABILITIES } from '@/triggers/slack/capabilities'

/** Stable discriminator emitted as `event.kind` on the v2 trigger output. */
export type SlackEventKind =
  | 'message'
  | 'app_mention'
  | 'reaction'
  | 'slash_command'
  | 'block_action'
  | 'shortcut'
  | 'view_submission'
  | 'view_closed'
  | 'assistant_thread_started'
  | 'assistant_thread_context_changed'
  | 'unknown'

/**
 * Interactivity payload types Slack POSTs as a form-encoded `payload` field.
 * See https://api.slack.com/interactivity/handling#payloads
 */
const INTERACTIVE_TYPES = new Set([
  'block_actions',
  'interactive_message',
  'message_action',
  'shortcut',
  'view_submission',
  'view_closed',
  'block_suggestion',
])

/**
 * Message subtypes that represent genuine user content and are kept by
 * default. Everything else (channel_join, message_changed, message_deleted,
 * channel_topic, ...) is dropped unless explicitly allowed via config.
 */
export const SLACK_V2_DEFAULT_KEPT_SUBTYPES = new Set(['file_share', 'thread_broadcast'])

export interface SlackPayloadClassification {
  kind: SlackEventKind
  /** Which payload family delivered it (distinct URL encodings, same endpoint). */
  family: 'event' | 'interactive' | 'slash'
  /** The inner Events-API event object, when family === 'event'. */
  rawEvent: Record<string, unknown> | null
  /** Channel ID, lifted uniformly (reaction item channel, interactive channel.id, ...). */
  channelId: string
  /** Events-API channel_type (channel | group | im | mpim) or '' when absent. */
  channelType: string
  /** Message subtype, '' when absent. */
  subtype: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Infers a channel_type from a Slack conversation ID prefix when the payload
 * does not carry one (C = public channel, G = private/mpim, D = im).
 */
export function channelTypeFromId(channelId: string): string {
  if (channelId.startsWith('C')) return 'channel'
  if (channelId.startsWith('G')) return 'group'
  if (channelId.startsWith('D')) return 'im'
  return ''
}

/** Classifies any payload arriving on the Slack webhook URL. */
export function classifySlackPayload(body: unknown): SlackPayloadClassification {
  const b = asRecord(body) ?? {}

  if (typeof b.command === 'string' && b.command.startsWith('/')) {
    const channelId = asString(b.channel_id)
    return {
      kind: 'slash_command',
      family: 'slash',
      rawEvent: null,
      channelId,
      channelType:
        asString(b.channel_name) === 'directmessage' ? 'im' : channelTypeFromId(channelId),
      subtype: '',
    }
  }

  const interactiveType = asString(b.type)
  if (!b.event && (INTERACTIVE_TYPES.has(interactiveType) || Array.isArray(b.actions))) {
    const channel = asRecord(b.channel)
    const channelId = asString(channel?.id)
    let kind: SlackEventKind = 'block_action'
    if (interactiveType === 'message_action' || interactiveType === 'shortcut') {
      kind = 'shortcut'
    } else if (interactiveType === 'view_submission') {
      kind = 'view_submission'
    } else if (interactiveType === 'view_closed') {
      kind = 'view_closed'
    }
    return {
      kind,
      family: 'interactive',
      rawEvent: null,
      channelId,
      channelType: channelTypeFromId(channelId),
      subtype: '',
    }
  }

  const rawEvent = asRecord(b.event)
  if (rawEvent) {
    const eventType = asString(rawEvent.type)
    if (eventType === 'app_mention' || eventType === 'message') {
      const channelId = asString(rawEvent.channel)
      return {
        kind: eventType === 'app_mention' ? 'app_mention' : 'message',
        family: 'event',
        rawEvent,
        channelId,
        channelType: asString(rawEvent.channel_type) || channelTypeFromId(channelId),
        subtype: asString(rawEvent.subtype),
      }
    }
    if (eventType === 'reaction_added' || eventType === 'reaction_removed') {
      const item = asRecord(rawEvent.item)
      const channelId = asString(item?.channel)
      return {
        kind: 'reaction',
        family: 'event',
        rawEvent,
        channelId,
        channelType: channelTypeFromId(channelId),
        subtype: '',
      }
    }
    if (
      eventType === 'assistant_thread_started' ||
      eventType === 'assistant_thread_context_changed'
    ) {
      const assistantThread = asRecord(rawEvent.assistant_thread)
      const channelId = asString(assistantThread?.channel_id)
      return {
        kind: eventType as SlackEventKind,
        family: 'event',
        rawEvent,
        channelId,
        channelType: channelTypeFromId(channelId) || 'im',
        subtype: '',
      }
    }
    return {
      kind: 'unknown',
      family: 'event',
      rawEvent,
      channelId: asString(rawEvent.channel),
      channelType: asString(rawEvent.channel_type),
      subtype: asString(rawEvent.subtype),
    }
  }

  return {
    kind: 'unknown',
    family: 'event',
    rawEvent: null,
    channelId: '',
    channelType: '',
    subtype: '',
  }
}

/**
 * Maps a classified payload to the trigger capability that opts into it.
 * Returns null when no capability governs the payload (always dropped).
 */
export function capabilityForPayload(c: SlackPayloadClassification): string | null {
  switch (c.kind) {
    case 'app_mention':
      return 'trigger_mention'
    case 'message':
      switch (c.channelType) {
        case 'im':
          return 'trigger_dm'
        case 'mpim':
          return 'trigger_group_dm'
        case 'group':
          return 'trigger_private_channel'
        case 'channel':
          return 'trigger_public_channel'
        default:
          return null
      }
    case 'reaction':
      return 'trigger_reaction'
    case 'slash_command':
      return 'trigger_slash_command'
    case 'block_action':
    case 'view_submission':
    case 'view_closed':
      return 'trigger_interactivity'
    case 'shortcut':
      return 'trigger_shortcut'
    case 'assistant_thread_started':
    case 'assistant_thread_context_changed':
      return 'trigger_assistant'
    default:
      return null
  }
}

const CAPABILITY_DEFAULTS = new Map(
  SLACK_CAPABILITIES.filter((c) => c.group === 'trigger').map((c) => [c.id, c.defaultChecked])
)

function isCapabilityEnabled(config: Record<string, unknown>, capabilityId: string): boolean {
  const value = config[capabilityId]
  if (typeof value === 'boolean') return value
  return CAPABILITY_DEFAULTS.get(capabilityId) ?? false
}

function configBoolean(
  config: Record<string, unknown>,
  key: string,
  defaultValue: boolean
): boolean {
  const value = config[key]
  return typeof value === 'boolean' ? value : defaultValue
}

/** Reads a multi-select dropdown value defensively (array, JSON string, or single id). */
function configStringList(config: Record<string, unknown>, key: string): string[] {
  const value = config[key]
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean)
    } catch {
      /* single plain id */
    }
    return [value.trim()]
  }
  return []
}

interface TableRowValue {
  cells?: Record<string, string>
}

/** Extracts one column from a `table` sub-block value. */
export function tableColumnValues(value: unknown, column: string): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => asString((row as TableRowValue)?.cells?.[column]))
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * The app's own identity, used for deterministic self-suppression.
 * Sourced from the event envelope (`authorizations`, `api_app_id`) and,
 * when available, a cached `auth.test` for non-event payload families.
 */
export interface SlackSelfIdentity {
  /** The app's bot user id (e.g. U0B35UA5KV1). */
  botUserId: string
  /** The app's bot id (e.g. B0...). */
  botId: string
  /** The app id (e.g. A0...). */
  appId: string
}

/**
 * Extracts the app's identity from an Events-API envelope without any API
 * call: `authorizations[0].user_id` is this app's bot user when `is_bot`.
 */
export function selfIdentityFromEnvelope(body: unknown): Partial<SlackSelfIdentity> {
  const b = asRecord(body) ?? {}
  const identity: Partial<SlackSelfIdentity> = {}
  const appId = asString(b.api_app_id)
  if (appId) identity.appId = appId
  const authorizations = Array.isArray(b.authorizations) ? b.authorizations : []
  const auth = asRecord(authorizations[0])
  if (auth && auth.is_bot === true) {
    const userId = asString(auth.user_id)
    if (userId) identity.botUserId = userId
  }
  return identity
}

export interface SlackV2MatchResult {
  pass: boolean
  /** Stable, log-friendly reason for dropped events. */
  reason?: string
}

/**
 * Decides whether a payload should invoke a v2-triggered workflow.
 *
 * Order: opt-in → subtype noise filter → bot/self suppression → channel
 * scope → mention-overlap guard → slash-command allowlist. Purely
 * deterministic; see module docs.
 */
export function evaluateSlackV2Match(
  body: unknown,
  providerConfig: Record<string, unknown>,
  self: Partial<SlackSelfIdentity>
): SlackV2MatchResult {
  const b = asRecord(body) ?? {}
  const c = classifySlackPayload(body)

  const capability = capabilityForPayload(c)
  if (!capability) {
    return { pass: false, reason: `unsupported payload (kind: ${c.kind})` }
  }
  if (!isCapabilityEnabled(providerConfig, capability)) {
    return { pass: false, reason: `event type not opted in (${capability})` }
  }

  // Subtype noise filter — genuine user messages only, plus configured extras.
  if (c.kind === 'message' && c.subtype) {
    const extraAllowed = asString(providerConfig.allowedSubtypes)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const allowed =
      SLACK_V2_DEFAULT_KEPT_SUBTYPES.has(c.subtype) ||
      extraAllowed.includes(c.subtype) ||
      // bot_message passes the subtype filter so the bot toggles below stay
      // the single decision point for bot-authored content.
      c.subtype === 'bot_message'
    if (!allowed) {
      return { pass: false, reason: `subtype filtered (${c.subtype})` }
    }
  }

  const ignoreBots = configBoolean(providerConfig, 'ignoreBotMessages', true)
  const ignoreOwn = configBoolean(providerConfig, 'ignoreOwnMessages', true)

  if (c.kind === 'message' || c.kind === 'app_mention') {
    const botId = asString(c.rawEvent?.bot_id)
    const isBotMessage = Boolean(botId) || c.subtype === 'bot_message'
    if (isBotMessage && ignoreBots) {
      return { pass: false, reason: 'bot message (ignoreBotMessages)' }
    }
    if (ignoreBots || ignoreOwn) {
      const eventAppId = asString(c.rawEvent?.app_id)
      const eventUser = asString(c.rawEvent?.user)
      const isSelf =
        (self.botUserId && eventUser === self.botUserId) ||
        (self.botId && botId && botId === self.botId) ||
        (self.appId && eventAppId && eventAppId === self.appId)
      if (isSelf) {
        return { pass: false, reason: 'own app message (ignoreOwnMessages)' }
      }
    }
  }

  if (c.kind === 'reaction' && (ignoreBots || ignoreOwn)) {
    const reactingUser = asString(c.rawEvent?.user)
    if (self.botUserId && reactingUser === self.botUserId) {
      return { pass: false, reason: 'own app reaction (ignoreOwnMessages)' }
    }
  }

  // Channel scope filter — message-family events in channels only; DMs,
  // interactivity, slash commands, and assistant threads are unaffected.
  if (c.kind === 'message' || c.kind === 'app_mention' || c.kind === 'reaction') {
    const channelFilter = configStringList(providerConfig, 'channelFilter')
    const isChannelScoped = c.channelType === 'channel' || c.channelType === 'group'
    if (channelFilter.length > 0 && isChannelScoped && !channelFilter.includes(c.channelId)) {
      return { pass: false, reason: `channel not in filter (${c.channelId})` }
    }
  }

  // Mention-overlap guard: when both app_mention and channel messages are
  // enabled, a mention produces two events. Drop the `message` copy that
  // contains this app's own mention — the app_mention copy still fires.
  if (
    c.kind === 'message' &&
    (c.channelType === 'channel' || c.channelType === 'group') &&
    isCapabilityEnabled(providerConfig, 'trigger_mention') &&
    configBoolean(providerConfig, 'skipMentionMessageCopies', true) &&
    self.botUserId
  ) {
    const text = asString(c.rawEvent?.text)
    if (text.includes(`<@${self.botUserId}>`)) {
      return { pass: false, reason: 'mention copy suppressed (delivered as app_mention)' }
    }
  }

  if (c.kind === 'slash_command') {
    const allowedCommands = tableColumnValues(providerConfig.slashCommands, 'Command')
      .map(normalizeSlashCommand)
      .filter(Boolean)
    const command = normalizeSlashCommand(asString(b.command))
    if (allowedCommands.length > 0 && !allowedCommands.includes(command)) {
      return { pass: false, reason: `slash command not configured (${command})` }
    }
  }

  return { pass: true }
}
