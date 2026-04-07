import { IntercomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIntercomExtraFields,
  buildIntercomGenericOutputs,
  intercomSetupInstructions,
  intercomTriggerOptions,
} from '@/triggers/intercom/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Intercom Generic Webhook Trigger
 *
 * Accepts all Intercom webhook events.
 */
export const intercomWebhookTrigger: TriggerConfig = {
  id: 'intercom_webhook',
  name: 'Intercom Webhook (All Events)',
  provider: 'intercom',
  description: 'Trigger workflow on any Intercom webhook event',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_webhook',
    triggerOptions: intercomTriggerOptions,
    setupInstructions: intercomSetupInstructions(
      'events you want to receive (conversation, contact, user, company, ticket, etc.)'
    ),
    extraFields: buildIntercomExtraFields('intercom_webhook'),
  }),

  outputs: buildIntercomGenericOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
