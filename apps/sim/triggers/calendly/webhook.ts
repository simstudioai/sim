import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const calendlyWebhookTrigger: TriggerConfig = {
  id: 'calendly_webhook',
  name: 'Calendly Webhook',
  provider: 'calendly',
  description: 'Trigger workflow from any Calendly webhook event',
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
        value: 'calendly_webhook',
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
        value: 'calendly_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'calendly_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_webhook',
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
        'The webhook will be automatically created in Calendly when you deploy the workflow.',
        'This webhook subscribes to all Calendly events (invitee created, invitee canceled, and routing form submitted). Use the <code>event</code> field in the payload to determine the event type.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_webhook',
      },
    },
  ],

  outputs: {
    event: {
      type: 'string',
      description:
        'Event type (invitee.created, invitee.canceled, or routing_form_submission.created)',
    },
    created_at: {
      type: 'string',
      description: 'Webhook event creation timestamp',
    },
    created_by: {
      type: 'string',
      description: 'URI of the Calendly user who created this webhook',
    },
    payload: {
      type: 'object',
      description: 'Complete event payload (structure varies by event type)',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Calendly-Webhook-Signature': 'v1,signature...',
      'User-Agent': 'Calendly-Webhook',
    },
  },
}
