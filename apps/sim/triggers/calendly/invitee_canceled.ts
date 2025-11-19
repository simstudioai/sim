import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildInviteeOutputs, calendlySetupInstructions } from './utils'

export const calendlyInviteeCanceledTrigger: TriggerConfig = {
  id: 'calendly_invitee_canceled',
  name: 'Calendly Invitee Canceled',
  provider: 'calendly',
  description: 'Trigger workflow when someone cancels a scheduled event on Calendly',
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
        value: 'calendly_invitee_canceled',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: calendlySetupInstructions(
        'invitee.canceled',
        'This webhook will trigger when an invitee cancels an event. The payload includes cancellation details such as who canceled (host or invitee) and the reason if provided.'
      ),
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
