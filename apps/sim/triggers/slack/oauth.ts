import { SlackIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  SLACK_ALL_EVENT_OPTIONS,
  SLACK_SIM_EVENT_OPTIONS,
  SLACK_SOURCE_OPTIONS,
  SLACK_THREAD_OPTIONS,
  SLACK_TRIGGER_OUTPUTS,
  slackEventsSupportingFilter,
} from '@/triggers/slack/shared'
import type { TriggerConfig } from '@/triggers/types'

// Filter sub-block gating is derived from the catalog's `filters` field so the
// UI conditions and the ingest route share one source of truth.
const SOURCE_FILTER_EVENTS = slackEventsSupportingFilter('source')
const CHANNEL_FILTER_EVENTS = slackEventsSupportingFilter('channels')
const THREAD_FILTER_EVENTS = slackEventsSupportingFilter('threads')
const EMOJI_FILTER_EVENTS = slackEventsSupportingFilter('emoji')
const NAME_FILTER_EVENTS = slackEventsSupportingFilter('name')
// Bot/own toggles gate UI visibility only (the route applies them unconditionally),
// so they are not catalog `filters`.
const BOT_FILTER_EVENTS = ['message', 'app_mention']
const OWN_MESSAGE_EVENTS = ['message', 'app_mention', 'reaction_added', 'reaction_removed']

/**
 * Unified Slack trigger. App Type selects how events arrive:
 * - `sim` (default): the official Sim Slack app the user OAuth-connects — events
 *   route to this workflow by Slack `team_id` (stored as the webhook `routingKey`,
 *   derived at deploy time). No signing secret, bot token, or app setup.
 * - `custom`: a bring-your-own Slack app — events arrive on a per-workflow webhook
 *   URL and are verified with the app's own signing secret.
 */
export const slackOAuthTrigger: TriggerConfig = {
  id: 'slack_oauth',
  name: 'Slack',
  provider: 'slack_app',
  description: 'Trigger from Slack events (mentions, messages, reactions)',
  version: '1.0.0',
  icon: SlackIcon,

  subBlocks: [
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: [...SLACK_SIM_EVENT_OPTIONS],
      placeholder: 'Select an event',
      description:
        'The single Slack event this trigger fires on. Add another trigger block for another event.',
      required: true,
      mode: 'trigger',
      dependsOn: ['appType'],
      fetchOptions: async (blockId: string) => {
        const appType = useSubBlockStore.getState().getValue(blockId, 'appType')
        return appType === 'custom' ? [...SLACK_ALL_EVENT_OPTIONS] : [...SLACK_SIM_EVENT_OPTIONS]
      },
    },
    {
      id: 'appType',
      title: 'App Type',
      type: 'dropdown',
      options: [
        { label: 'Sim', id: 'sim' },
        { label: 'Custom', id: 'custom' },
      ],
      value: () => 'sim',
      description: 'Use the official Sim Slack app, or your own custom Slack app.',
      mode: 'trigger',
    },
    {
      id: 'triggerCredentials',
      title: 'Slack Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'slack',
      requiredScopes: getScopesForService('slack'),
      placeholder: 'Select Slack account',
      required: { field: 'appType', value: 'sim' },
      mode: 'trigger',
      condition: { field: 'appType', value: 'sim' },
    },
    {
      id: 'source',
      title: 'Source',
      type: 'dropdown',
      multiSelect: true,
      options: [...SLACK_SOURCE_OPTIONS],
      placeholder: 'Any source',
      description:
        'Restrict to direct messages, public channels, or private channels. Leave empty to match any.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: SOURCE_FILTER_EVENTS },
    },
    {
      id: 'channelFilter',
      title: 'Channels',
      type: 'channel-selector',
      canonicalParamId: 'channelFilter',
      multiSelect: true,
      serviceId: 'slack',
      selectorKey: 'slack.channels',
      placeholder: 'Any channel the bot is in',
      description:
        'Restrict to specific channels. Leave empty to trigger on any channel the bot has been added to.',
      dependsOn: ['triggerCredentials'],
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: CHANNEL_FILTER_EVENTS },
    },
    {
      id: 'manualChannelFilter',
      title: 'Channel IDs',
      type: 'short-input',
      canonicalParamId: 'channelFilter',
      placeholder: 'C0123456789, C0987654321',
      description: 'Comma-separated channel IDs to restrict to. Set IDs directly here.',
      required: false,
      mode: 'trigger-advanced',
      condition: { field: 'eventType', value: CHANNEL_FILTER_EVENTS },
    },
    {
      id: 'threads',
      title: 'Threads',
      type: 'dropdown',
      options: [...SLACK_THREAD_OPTIONS],
      value: () => 'include',
      description:
        'Include thread replies, exclude them (top-level only), or fire only on thread replies.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: THREAD_FILTER_EVENTS },
    },
    {
      id: 'emoji',
      title: 'Emoji',
      type: 'short-input',
      placeholder: 'thumbsup, white_check_mark',
      description: 'Comma-separated emoji names to restrict to. Leave empty to match any emoji.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: EMOJI_FILTER_EVENTS },
    },
    {
      id: 'nameContains',
      title: 'Name contains',
      type: 'short-input',
      placeholder: 'incident-',
      description: 'Only fire when the created channel name contains this text.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: NAME_FILTER_EVENTS },
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
      condition: { field: 'appType', value: 'custom' },
    },
    {
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Enter your Slack app signing secret',
      description: 'The signing secret from your Slack app to validate request authenticity.',
      password: true,
      required: { field: 'appType', value: 'custom' },
      mode: 'trigger',
      condition: { field: 'appType', value: 'custom' },
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'xoxb-...',
      description:
        'The bot token from your Slack app. Required for downloading files attached to messages.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: { field: 'appType', value: 'custom' },
    },
    {
      id: 'filterBotMessages',
      title: 'Ignore bot messages',
      type: 'switch',
      defaultValue: true,
      description: "Ignore messages sent by other bots. This app's own output is always ignored.",
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: BOT_FILTER_EVENTS },
    },
    {
      id: 'includeOwnMessages',
      title: 'Include own bot messages',
      type: 'switch',
      defaultValue: false,
      description:
        "Also fire on this app's own messages and reactions. Can cause loops — use with care.",
      required: false,
      mode: 'trigger-advanced',
      condition: { field: 'eventType', value: OWN_MESSAGE_EVENTS },
    },
    {
      id: 'includeFiles',
      title: 'Include file attachments',
      type: 'switch',
      defaultValue: false,
      description: 'Download and include file attachments from messages. Requires files:read.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: 'message' },
    },
    {
      id: 'setupWizard',
      title: 'Slack App Setup',
      type: 'modal',
      modalId: 'slack-setup-wizard',
      description: 'Walk through manifest creation, app install, and pasting credentials.',
      hideFromPreview: true,
      mode: 'trigger',
      condition: { field: 'appType', value: 'custom' },
    },
  ],

  outputs: SLACK_TRIGGER_OUTPUTS,

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
