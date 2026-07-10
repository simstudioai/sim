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
const INTERACTION_FILTER_EVENTS = slackEventsSupportingFilter('interaction')
// Bot/own toggles gate UI visibility only (the route applies them unconditionally),
// so they are not catalog `filters`.
const BOT_FILTER_EVENTS = ['message', 'app_mention']
const OWN_MESSAGE_EVENTS = ['message', 'app_mention', 'reaction_added', 'reaction_removed']

/**
 * Unified Slack trigger. App Type selects how events arrive:
 * - `sim` (default): the official Sim Slack app the user OAuth-connects — events
 *   route to this workflow by Slack `team_id` (stored as the webhook `routingKey`,
 *   derived at deploy time). No signing secret, bot token, or app setup.
 * - `custom`: a bring-your-own Slack app, selected as a reusable bot credential
 *   (set up once). Events route by that credential (`webhook.routingKey =
 *   credentialId`) to one shared ingest URL, so many triggers on the same bot
 *   share a single Request URL, verified with the bot's own signing secret.
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
      // Ship 1 exposes custom bots only; the native "Sim" app mode returns in a
      // later ship (un-hide + default back to 'sim'). Hidden — not removed — so
      // the seeded 'custom' value keeps every `appType==='custom'` condition, the
      // event-catalog fetch, and the deploy routing branch resolving correctly.
      hidden: true,
      options: [
        { label: 'Sim', id: 'sim' },
        { label: 'Custom', id: 'custom' },
      ],
      value: () => 'custom',
      // `value()` only seeds editor-created blocks; `defaultValue` is what
      // buildProviderConfig persists when the stored value is absent
      // (imported / programmatically-created workflows).
      defaultValue: 'custom',
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
      id: 'customBotCredential',
      title: 'Slack Bot',
      type: 'oauth-input',
      canonicalParamId: 'botCredential',
      serviceId: 'slack',
      credentialKind: 'custom-bot',
      requiredScopes: getScopesForService('slack'),
      placeholder: 'Select a connected bot',
      description:
        'Choose a custom Slack bot you set up once and reuse across triggers and actions.',
      required: { field: 'appType', value: 'custom' },
      mode: 'trigger',
      condition: { field: 'appType', value: 'custom' },
    },
    {
      id: 'manualBotCredential',
      title: 'Bot Credential ID',
      type: 'short-input',
      canonicalParamId: 'botCredential',
      placeholder: 'Enter bot credential ID',
      description: 'Set the custom bot credential ID directly.',
      required: { field: 'appType', value: 'custom' },
      mode: 'trigger-advanced',
      condition: { field: 'appType', value: 'custom' },
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
      dependsOn: { any: ['triggerCredentials', 'customBotCredential'] },
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
      id: 'interactionFilter',
      title: 'Action / Callback ID',
      type: 'short-input',
      placeholder: 'approve_btn, deny_btn',
      description:
        'Comma-separated action_ids (buttons/selects) or callback_ids (modals) to restrict to. Leave empty to fire on any interaction.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: INTERACTION_FILTER_EVENTS },
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
  ],

  outputs: SLACK_TRIGGER_OUTPUTS,

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
