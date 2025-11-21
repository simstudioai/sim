import { CalendlyIcon } from '@/components/icons'
import { buildRoutingFormOutputs } from '@/triggers/calendly/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calendlyRoutingFormSubmittedTrigger: TriggerConfig = {
  id: 'calendly_routing_form_submitted',
  name: 'Calendly Routing Form Submitted',
  provider: 'calendly',
  description: 'Trigger workflow when someone submits a Calendly routing form',
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
        value: 'calendly_routing_form_submitted',
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
        value: 'calendly_routing_form_submitted',
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
        'This webhook triggers when someone submits a routing form, regardless of whether they book an event.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_routing_form_submitted',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'calendly_routing_form_submitted',
      condition: {
        field: 'selectedTriggerId',
        value: 'calendly_routing_form_submitted',
      },
    },
  ],

  outputs: buildRoutingFormOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Calendly-Webhook-Signature': 'v1,signature...',
      'User-Agent': 'Calendly-Webhook',
    },
  },
}
