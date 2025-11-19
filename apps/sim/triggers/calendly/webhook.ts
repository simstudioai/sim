import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { calendlySetupInstructions } from './utils'

export const calendlyWebhookTrigger: TriggerConfig = {
  id: 'calendly_webhook',
  name: 'Calendly Webhook',
  provider: 'calendly',
  description: 'Trigger workflow from any Calendly webhook event',
  version: '1.0.0',
  icon: CalendlyIcon,

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
      defaultValue: calendlySetupInstructions(
        'all events (invitee.created, invitee.canceled, routing_form_submission.created)',
        'This webhook will receive all Calendly events. Use the <code>event</code> field in the payload to filter and handle different event types. Available events: <code>invitee.created</code>, <code>invitee.canceled</code>, and <code>routing_form_submission.created</code>.'
      ),
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
