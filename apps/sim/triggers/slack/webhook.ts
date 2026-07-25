import { SlackIcon } from '@/components/icons'
import { SLACK_TRIGGER_OUTPUTS } from '@/triggers/slack/shared'
import type { TriggerConfig } from '@/triggers/types'

export const slackWebhookTrigger: TriggerConfig = {
  id: 'slack_webhook',
  name: 'Slack Webhook',
  provider: 'slack',
  description: 'Trigger workflow from Slack events like mentions, messages, and reactions',
  version: '1.0.0',
  icon: SlackIcon,

  subBlocks: [
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
        'The bot token from your Slack app. Required for downloading files attached to messages.',
      password: true,
      required: false,
      mode: 'trigger',
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
      id: 'setupWizard',
      title: 'Slack app setup',
      type: 'modal',
      modalId: 'slack-setup-wizard',
      description: 'Walk through manifest creation, app install, and pasting credentials.',
      hideFromPreview: true,
      mode: 'trigger',
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
