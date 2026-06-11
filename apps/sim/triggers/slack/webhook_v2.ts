import { SlackIcon } from '@/components/icons'
import {
  fetchSlackChannelOptionByIdForTrigger,
  fetchSlackChannelOptionsForTrigger,
} from '@/lib/workflows/subblocks/slack-options'
import type { SubBlockConfig } from '@/blocks/types'
import { SLACK_CAPABILITIES } from '@/triggers/slack/capabilities'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Hides v2-only fields on legacy blocks that are still pinned to the v1
 * trigger (stored `triggerId` of `slack_webhook`), so their panel keeps the
 * v1 shape until the trigger is recreated.
 */
const NOT_LEGACY_V1 = { field: 'triggerId', value: 'slack_webhook', not: true } as const

const TRIGGER_EVENT_OPTIONS = SLACK_CAPABILITIES.filter((c) => c.group === 'trigger').map((c) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  defaultChecked: c.defaultChecked,
}))

const subBlocks: SubBlockConfig[] = [
  {
    id: 'setupWizard',
    title: 'Slack app setup',
    type: 'modal',
    modalId: 'slack-setup-wizard',
    description:
      'Walk through manifest creation, app install, and pasting credentials. The events you pick below are written into the manifest automatically.',
    hideFromPreview: true,
    mode: 'trigger',
  },
  {
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: 'Webhook URL will be generated',
    mode: 'trigger',
  },
  {
    id: 'signingSecret',
    title: 'Signing Secret',
    type: 'short-input',
    placeholder: 'Enter your Slack app signing secret',
    description: 'The signing secret from your Slack app to validate request authenticity.',
    password: true,
    required: true,
    mode: 'trigger',
  },
  {
    id: 'botToken',
    title: 'Bot Token',
    type: 'short-input',
    placeholder: 'xoxb-...',
    description:
      'The bot token from your Slack app. Used to resolve channel names, identify your own bot (loop prevention), fetch reaction message text, and download files.',
    password: true,
    required: false,
    mode: 'trigger',
  },
  {
    id: 'triggerEvents',
    title: 'Trigger on',
    type: 'checkbox-list',
    options: TRIGGER_EVENT_OPTIONS,
    description:
      'Only checked event types run the workflow — everything else is dropped before execution. Checking @mention and channel messages together delivers a mention twice (once per type); the toggle below drops the duplicate message copy for you.',
    mode: 'trigger',
    condition: NOT_LEGACY_V1,
  },
  {
    id: 'slashCommands',
    title: 'Slash Commands',
    type: 'table',
    columns: ['Command', 'Description'],
    description:
      'Commands are added to the app manifest pointing at this webhook (e.g. /mybot). Only the commands listed here trigger the workflow.',
    mode: 'trigger',
    condition: { field: 'trigger_slash_command', value: true, and: NOT_LEGACY_V1 },
  },
  {
    id: 'shortcuts',
    title: 'Message Shortcuts',
    type: 'table',
    columns: ['Name', 'Description'],
    description:
      'Added to the app manifest as message shortcuts. The callback_id is derived from the name (e.g. "Summarize this" → summarize_this) and arrives on the trigger output.',
    mode: 'trigger',
    condition: { field: 'trigger_shortcut', value: true, and: NOT_LEGACY_V1 },
  },
  {
    id: 'ignoreBotMessages',
    title: 'Ignore Bot Messages',
    type: 'switch',
    defaultValue: true,
    description:
      'Drop messages authored by any bot, including this app. Prevents bot-to-bot trigger loops.',
    mode: 'trigger',
    condition: NOT_LEGACY_V1,
  },
  {
    id: 'ignoreOwnMessages',
    title: "Ignore This App's Own Messages",
    type: 'switch',
    defaultValue: true,
    description:
      "Drop only this app's own messages (other bots still trigger). Identified by the app's bot user — never by message content. Turning this off can cause infinite loops.",
    mode: 'trigger',
    condition: { field: 'ignoreBotMessages', value: false, and: NOT_LEGACY_V1 },
  },
  {
    id: 'skipMentionMessageCopies',
    title: 'Deduplicate @mention Deliveries',
    type: 'switch',
    defaultValue: true,
    description:
      'A mention in a watched channel arrives twice from Slack: as app_mention and as a channel message. When on, the channel-message copy is dropped and only app_mention fires.',
    mode: 'trigger',
    condition: { field: 'trigger_mention', value: true, and: NOT_LEGACY_V1 },
  },
  {
    id: 'channelFilter',
    title: 'Only These Channels',
    type: 'dropdown',
    multiSelect: true,
    options: [],
    placeholder: 'All channels',
    description:
      'Limit channel messages, mentions, and reactions to specific channels. Leave empty for all channels the bot is in. DMs, slash commands, and shortcuts are unaffected. Requires the bot token to load the channel list.',
    mode: 'trigger',
    dependsOn: ['botToken'],
    fetchOptions: (blockId: string) => fetchSlackChannelOptionsForTrigger(blockId),
    fetchOptionById: (blockId: string, optionId: string) =>
      fetchSlackChannelOptionByIdForTrigger(blockId, optionId),
    condition: NOT_LEGACY_V1,
  },
  {
    id: 'includeFiles',
    title: 'Include File Attachments',
    type: 'switch',
    defaultValue: false,
    description:
      'Download and include file attachments from messages. Requires a bot token with files:read scope.',
    required: false,
    mode: 'trigger',
  },
  {
    id: 'allowedSubtypes',
    title: 'Extra Message Subtypes',
    type: 'short-input',
    placeholder: 'e.g. message_changed, channel_topic',
    description:
      'System message subtypes (joins, edits, deletes, topic changes, …) are dropped by default; regular messages, file_share, and thread_broadcast always pass. List extra subtypes to allow, comma-separated.',
    required: false,
    mode: 'trigger',
    condition: NOT_LEGACY_V1,
  },
]

export const slackWebhookV2Trigger: TriggerConfig = {
  id: 'slack_webhook_v2',
  name: 'Slack Webhook',
  provider: 'slack',
  description:
    'Trigger workflow from Slack events you opt into — mentions, messages, reactions, slash commands, buttons, shortcuts, and AI assistant threads — with built-in bot/self suppression and noise filtering',
  version: '2.0.0',
  icon: SlackIcon,

  subBlocks,

  outputs: {
    event: {
      type: 'object',
      description: 'Normalized Slack event data',
      properties: {
        kind: {
          type: 'string',
          description:
            'Stable event discriminator: message | app_mention | reaction | slash_command | block_action | shortcut | view_submission | view_closed | assistant_thread_started | assistant_thread_context_changed',
        },
        event_type: {
          type: 'string',
          description:
            'Raw Slack payload type (e.g. app_mention, message, block_actions, slash_command). Prefer kind for routing.',
        },
        subtype: {
          type: 'string',
          description:
            'Message subtype (e.g. file_share, thread_broadcast). Empty for regular user messages',
        },
        channel: {
          type: 'string',
          description: 'Slack channel ID where the event occurred',
        },
        channel_name: {
          type: 'string',
          description:
            'Human-readable channel name, resolved via the Slack API and cached when the payload omits it (requires bot token). Empty for DMs',
        },
        channel_type: {
          type: 'string',
          description: 'Type of channel: channel (public), group (private), im (DM), or mpim',
        },
        user: {
          type: 'string',
          description: 'User ID who triggered the event',
        },
        user_name: {
          type: 'string',
          description: 'Username who triggered the event (interactivity and slash commands)',
        },
        bot_id: {
          type: 'string',
          description: 'Bot ID if the message was sent by a bot. Empty for human users',
        },
        bot_user_id: {
          type: 'string',
          description:
            "This app's own bot user ID (e.g. U0123456789) — use it to detect mentions of your bot without hardcoding the ID",
        },
        app_id: {
          type: 'string',
          description: "This app's Slack app ID",
        },
        text: {
          type: 'string',
          description:
            'Message text exactly as Slack delivers it (mentions arrive as <@U…>). For slash commands, the text after the command. For reactions, the reacted-to message text (requires bot token)',
        },
        timestamp: {
          type: 'string',
          description: 'Timestamp (ts) of the triggering message or event',
        },
        thread_ts: {
          type: 'string',
          description:
            'Resolved thread anchor: the parent thread for replies, otherwise the message’s own ts. Always safe to use as thread_ts when replying in-thread',
        },
        team_id: {
          type: 'string',
          description: 'Slack workspace/team ID',
        },
        event_id: {
          type: 'string',
          description: 'Unique event identifier (deduplicated by the platform before execution)',
        },
        reaction: {
          type: 'string',
          description: 'Emoji reaction name (e.g. thumbsup). Present for reaction events',
        },
        reaction_action: {
          type: 'string',
          description: 'Whether the reaction was added or removed. Present for reaction events',
        },
        item_user: {
          type: 'string',
          description: 'User ID of the reacted-to message author. Present for reaction events',
        },
        command: {
          type: 'string',
          description:
            'Slash command name including the leading slash (e.g. /deploy). Present for slash commands',
        },
        action_id: {
          type: 'string',
          description:
            'action_id of the first interactive element triggered. Present for block_action',
        },
        action_value: {
          type: 'string',
          description:
            'Value carried by the first interactive element (button value, selected option, date, etc.). Present for block_action',
        },
        actions: {
          type: 'json',
          description:
            'Full array of interactive actions from the payload, preserving every element and its value. Present for block_action',
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
          description: 'Callback ID of the shortcut or view. Present for shortcuts and modals',
        },
        api_app_id: {
          type: 'string',
          description: 'Slack app ID from the payload envelope',
        },
        message_ts: {
          type: 'string',
          description: 'Timestamp of the message the interaction or reaction originated from',
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
        raw: {
          type: 'json',
          description:
            'The complete, unmodified Slack payload — escape hatch for fields not covered by the normalized schema',
        },
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
