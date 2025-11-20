import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildInviteeOutputs } from './utils'

export const calendlyInviteeCanceledTrigger: TriggerConfig = {
  id: 'calendly_invitee_canceled',
  name: 'Calendly Invitee Canceled',
  provider: 'calendly',
  description: 'Trigger workflow when someone cancels a scheduled event on Calendly',
  version: '1.0.0',
  icon: CalendlyIcon,

  subBlocks: [
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'Enter your Calendly personal access token',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_canceled',
      },
    },
    {
      id: 'organization',
      title: 'Organization URI',
      type: 'short-input',
      placeholder: 'https://api.calendly.com/organizations/XXXXXX',
      description:
        'Organization URI for the webhook subscription. Get this from "Get Current User" operation.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_canceled',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        '<strong>Note:</strong> This trigger requires a paid Calendly subscription (Professional, Teams, or Enterprise plan).',
        'Get your Personal Access Token from <strong>Settings > Integrations > API & Webhooks</strong> in your Calendly account.',
        'Use the "Get Current User" operation in a Calendly block to retrieve your Organization URI.',
        'The webhook will be automatically created in Calendly when you save this trigger.',
        'This webhook triggers when an invitee cancels an event. The payload includes cancellation details and reason.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_canceled',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'calendly_invitee_canceled',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_canceled',
      },
    },
  ],

  outputs: buildInviteeOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Calendly-Webhook-Signature': 'v1,signature...',
      'User-Agent': 'Calendly-Webhook',
    },
  },
}
