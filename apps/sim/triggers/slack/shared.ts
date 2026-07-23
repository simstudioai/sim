import type { TriggerOutput } from '@/triggers/types'

/**
 * Unified Slack trigger output shape, shared by the legacy bring-your-own-app
 * webhook trigger and the native OAuth (`slack_app`) trigger. Both normalize
 * Events API / interactivity / slash-command payloads into this shape via the
 * Slack webhook provider handler, so downstream blocks resolve identically
 * regardless of how the app was installed.
 */
export const SLACK_TRIGGER_OUTPUTS: Record<string, TriggerOutput> = {
  event: {
    type: 'object',
    description: 'Slack event data',
    properties: {
      event_type: {
        type: 'string',
        description:
          'Type of Slack payload: an Events API event (e.g., app_mention, message), an interactivity type (e.g., block_actions), or "slash_command" for slash commands',
      },
      subtype: {
        type: 'string',
        description:
          'Message subtype (e.g., channel_join, channel_leave, bot_message, file_share). Null for regular user messages',
      },
      channel: {
        type: 'string',
        description: 'Slack channel ID where the event occurred',
      },
      channel_name: {
        type: 'string',
        description: 'Human-readable channel name',
      },
      channel_type: {
        type: 'string',
        description:
          'Type of channel (e.g., channel, group, im, mpim). Useful for distinguishing DMs from public channels',
      },
      user: {
        type: 'string',
        description: 'User ID who triggered the event',
      },
      user_name: {
        type: 'string',
        description: 'Username who triggered the event',
      },
      bot_id: {
        type: 'string',
        description: 'Bot ID if the message was sent by a bot. Null for human users',
      },
      text: {
        type: 'string',
        description:
          'Message text content. For slash commands, the text after the command. For interactivity, the source message text (falls back to the triggering action value)',
      },
      timestamp: {
        type: 'string',
        description: 'Message timestamp from the triggering event',
      },
      thread_ts: {
        type: 'string',
        description: 'Parent thread timestamp (if message is in a thread)',
      },
      team_id: {
        type: 'string',
        description: 'Slack workspace/team ID',
      },
      event_id: {
        type: 'string',
        description: 'Unique event identifier',
      },
      reaction: {
        type: 'string',
        description:
          'Emoji reaction name (e.g., thumbsup). Present for reaction_added/reaction_removed events',
      },
      item_user: {
        type: 'string',
        description:
          'User ID of the original message author. Present for reaction_added/reaction_removed events',
      },
      command: {
        type: 'string',
        description:
          'Slash command name including the leading slash (e.g., /deploy). Present for slash commands',
      },
      action_id: {
        type: 'string',
        description:
          'action_id of the first interactive element triggered. Present for block_actions (button/select clicks)',
      },
      action_value: {
        type: 'string',
        description:
          'Value carried by the first interactive element (button value, selected option, date, etc.). Present for block_actions',
      },
      actions: {
        type: 'json',
        description:
          'Full array of interactive actions from the payload, preserving every element and its value. Present for block_actions',
      },
      response_url: {
        type: 'string',
        description:
          'Temporary URL to post a response back to the originating message or command. Present for interactivity and slash commands',
      },
      trigger_id: {
        type: 'string',
        description:
          'Short-lived trigger ID used to open a modal in response. Present for interactivity and slash commands',
      },
      callback_id: {
        type: 'string',
        description:
          'Callback ID of the shortcut or view. Present for shortcuts and modal submissions',
      },
      api_app_id: {
        type: 'string',
        description: 'Slack app ID. Present for interactivity and slash commands',
      },
      app_id: {
        type: 'string',
        description:
          "App ID of the app that produced the event (e.g. the bot that posted a message). Used to identify the app's own output",
      },
      message_ts: {
        type: 'string',
        description:
          'Timestamp of the message the interaction originated from. Present for block_actions',
      },
      view: {
        type: 'json',
        description:
          'Full Slack view object for modal interactions: state.values (submitted input values), private_metadata, id, callback_id, and hash. Present for view_submission/view_closed; null otherwise',
      },
      message: {
        type: 'json',
        description:
          'Full source message object the interaction came from, including its blocks and text. Present for block_actions on a message; null otherwise',
      },
      state: {
        type: 'json',
        description:
          'Current values of all stateful elements in the surface (state.values) at the time of a block action — e.g. inputs read on a button click. Present for block_actions; null otherwise',
      },
      hasFiles: {
        type: 'boolean',
        description: 'Whether the message has file attachments',
      },
      files: {
        type: 'file[]',
        description:
          'File attachments downloaded from the message (if includeFiles is enabled and bot token is provided)',
      },
    },
  },
}

/**
 * A contextual filter a Slack event can expose. Each entry's `filters` list
 * drives both which filter sub-blocks the trigger UI shows and which checks the
 * ingest route applies:
 * - `source`: restrict a message event to DMs / public / private channels.
 * - `channels`: restrict to specific channel IDs.
 * - `threads`: include / exclude / only thread replies.
 * - `emoji`: restrict a reaction event to specific emoji names.
 * - `name`: substring match on a created channel's name.
 * - `interaction`: restrict an interactivity event to specific `action_id`s
 *   (block_actions) or `callback_id`s (view_submission).
 */
export type SlackEventFilter = 'source' | 'channels' | 'threads' | 'emoji' | 'name' | 'interaction'

export interface SlackEventCatalogEntry {
  /** Selected value stored under the `eventType` sub-block. */
  id: string
  label: string
  /** True when the official shared Sim app already subscribes to the event. */
  simSubscribed: boolean
  /** Contextual filters this event supports. */
  filters: readonly SlackEventFilter[]
}

/**
 * The full catalog of selectable events for the native OAuth (`slack_app`)
 * trigger, and the single source of truth for event gating. One trigger block
 * fires on exactly one `id`. `simSubscribed` gates which events are offered in
 * Sim mode (the official app), while every event is offered in Custom mode
 * (the bring-your-own app generates a manifest that subscribes to it, driven by
 * SLACK_CAPABILITIES). `filters` drives both the trigger UI (which filter
 * sub-blocks show) and the ingest route (which checks apply).
 */
export const SLACK_EVENT_CATALOG: readonly SlackEventCatalogEntry[] = [
  {
    id: 'message',
    label: 'Message',
    simSubscribed: true,
    filters: ['source', 'channels', 'threads'],
  },
  {
    id: 'app_mention',
    label: 'App mentioned',
    simSubscribed: true,
    filters: ['channels', 'threads'],
  },
  {
    id: 'reaction_added',
    label: 'Reaction added',
    simSubscribed: true,
    filters: ['emoji', 'channels'],
  },
  {
    id: 'reaction_removed',
    label: 'Reaction removed',
    simSubscribed: true,
    filters: ['emoji', 'channels'],
  },
  {
    id: 'message_edited',
    label: 'Message edited',
    simSubscribed: true,
    filters: ['source', 'channels'],
  },
  {
    id: 'message_deleted',
    label: 'Message deleted',
    simSubscribed: true,
    filters: ['source', 'channels'],
  },
  { id: 'file_shared', label: 'File shared', simSubscribed: false, filters: ['channels'] },
  {
    id: 'member_joined_channel',
    label: 'Member joined channel',
    simSubscribed: false,
    filters: ['channels'],
  },
  {
    id: 'member_left_channel',
    label: 'Member left channel',
    simSubscribed: false,
    filters: ['channels'],
  },
  { id: 'channel_created', label: 'Channel created', simSubscribed: false, filters: ['name'] },
  { id: 'channel_archive', label: 'Channel archived', simSubscribed: false, filters: ['channels'] },
  { id: 'channel_rename', label: 'Channel renamed', simSubscribed: false, filters: ['channels'] },
  { id: 'pin_added', label: 'Pin added', simSubscribed: false, filters: ['channels'] },
  { id: 'pin_removed', label: 'Pin removed', simSubscribed: false, filters: ['channels'] },
  { id: 'team_join', label: 'Member joined workspace', simSubscribed: false, filters: [] },
  { id: 'app_home_opened', label: 'App home opened', simSubscribed: false, filters: [] },
  { id: 'assistant_thread_started', label: 'Assistant opened', simSubscribed: true, filters: [] },
  {
    id: 'assistant_thread_context_changed',
    label: 'Assistant context changed',
    simSubscribed: true,
    filters: [],
  },
  {
    id: 'block_actions',
    label: 'Button / select clicked',
    simSubscribed: true,
    filters: ['interaction'],
  },
  {
    id: 'view_submission',
    label: 'Modal submitted',
    simSubscribed: true,
    filters: ['interaction'],
  },
] as const

/** Catalog entry lookup by `eventType` id. */
export const slackEventById = new Map<string, SlackEventCatalogEntry>(
  SLACK_EVENT_CATALOG.map((entry) => [entry.id, entry])
)

/**
 * Event ids the official shared Sim app subscribes to. Single source of truth
 * for the deploy-time gate that rejects a native Sim-app trigger configured with
 * an event the shared app can't deliver.
 */
export const SIM_SUBSCRIBED_EVENTS: readonly string[] = SLACK_EVENT_CATALOG.filter(
  (entry) => entry.simSubscribed
).map((entry) => entry.id)

/** Dropdown options for the event picker — every selectable event. */
export const SLACK_ALL_EVENT_OPTIONS = SLACK_EVENT_CATALOG.map((entry) => ({
  label: entry.label,
  id: entry.id,
}))

/**
 * Message-source filter options. Each id maps to a Slack `channel_type`. The
 * filter is multiselect and empty means any source, so "public + private, no
 * DMs" is `[channel, group]` — a case a single-select could not express.
 */
export const SLACK_SOURCE_OPTIONS = [
  { label: 'Direct message', id: 'im' },
  { label: 'Public channel', id: 'channel' },
  { label: 'Private channel', id: 'group' },
] as const

/** Three-way thread filter options. */
export const SLACK_THREAD_OPTIONS = [
  { label: 'Messages and replies', id: 'include' },
  { label: 'Messages only (no replies)', id: 'exclude' },
  { label: 'Replies only', id: 'only' },
] as const

/** True when the given event id exposes the given contextual filter. */
export function slackEventSupportsFilter(eventType: string, filter: SlackEventFilter): boolean {
  return slackEventById.get(eventType)?.filters.includes(filter) ?? false
}

/**
 * Event ids that expose the given filter — the catalog-derived list used for
 * trigger sub-block `condition` gating, so the UI and the ingest route share one
 * source of truth.
 */
export function slackEventsSupportingFilter(filter: SlackEventFilter): string[] {
  return SLACK_EVENT_CATALOG.filter((entry) => entry.filters.includes(filter)).map(
    (entry) => entry.id
  )
}
