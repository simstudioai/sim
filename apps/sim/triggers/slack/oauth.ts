import { SlackIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { SLACK_TRIGGER_EVENT_OPTIONS, SLACK_TRIGGER_OUTPUTS } from '@/triggers/slack/shared'
import type { TriggerConfig } from '@/triggers/types'

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
      id: 'events',
      title: 'Operations',
      type: 'dropdown',
      multiSelect: true,
      options: [...SLACK_TRIGGER_EVENT_OPTIONS],
      placeholder: 'Select operations',
      description: 'Which Slack events should trigger this workflow.',
      required: true,
      mode: 'trigger',
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
      id: 'channelFilter',
      title: 'Channels (optional)',
      type: 'channel-selector',
      canonicalParamId: 'channelFilter',
      multiSelect: true,
      serviceId: 'slack',
      selectorKey: 'slack.channels',
      placeholder: 'Any channel the bot is in',
      description:
        'Restrict channel, mention, and reaction events to specific channels. Leave empty to trigger on any channel the bot has been added to. Does not apply to direct messages.',
      dependsOn: ['triggerCredentials'],
      required: false,
      mode: 'trigger',
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
      title: 'Filter bot messages',
      type: 'switch',
      defaultValue: true,
      description: 'Ignore messages sent by bots (including this app) to prevent loops.',
      required: false,
      mode: 'trigger',
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
