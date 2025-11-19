import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildRoutingFormOutputs, calendlySetupInstructions } from './utils'

export const calendlyRoutingFormSubmittedTrigger: TriggerConfig = {
  id: 'calendly_routing_form_submitted',
  name: 'Calendly Routing Form Submitted',
  provider: 'calendly',
  description: 'Trigger workflow when someone submits a Calendly routing form',
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
        value: 'calendly_routing_form_submitted',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: calendlySetupInstructions(
        'routing_form_submission.created',
        'This webhook will trigger when someone submits a routing form, regardless of whether they book an event. The payload includes the submitter information, their answers, and the routing result. <strong>Note:</strong> This event requires organization scope.'
      ),
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
