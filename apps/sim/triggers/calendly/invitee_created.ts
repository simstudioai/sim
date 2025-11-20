import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildInviteeOutputs, calendlyTriggerOptions } from './utils'

export const calendlyInviteeCreatedTrigger: TriggerConfig = {
  id: 'calendly_invitee_created',
  name: 'Calendly Invitee Created',
  provider: 'calendly',
  description: 'Trigger workflow when someone schedules a new event on Calendly',
  version: '1.0.0',
  icon: CalendlyIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: calendlyTriggerOptions,
      value: () => 'calendly_invitee_created',
      required: true,
    },
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
        value: 'calendly_invitee_created',
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
        value: 'calendly_invitee_created',
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
        'This webhook triggers when an invitee schedules a new event. Rescheduling triggers both cancellation and creation events.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'calendly_invitee_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_invitee_created',
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
