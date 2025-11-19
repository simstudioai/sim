import { CalendlyIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildInviteeOutputs, calendlySetupInstructions, calendlyTriggerOptions } from './utils'

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
        value: 'calendly_invitee_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: calendlySetupInstructions(
        'invitee.created',
        'This webhook will trigger when an invitee schedules a new event. Note that rescheduling will trigger both a <code>invitee.canceled</code> and a new <code>invitee.created</code> event.'
      ),
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
