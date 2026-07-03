import { LinqIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLinqExtraFields,
  buildLinqOutputs,
  linqSetupInstructions,
  linqTriggerOptions,
} from '@/triggers/linq/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Linq Webhook Trigger
 * Subscribes to every Linq webhook event type (messages, reactions, participants,
 * chats, typing, phone number status, location sharing). Use the <code>data</code>
 * output for the full payload, which varies by <code>eventType</code>.
 */
export const linqWebhookTrigger: TriggerConfig = {
  id: 'linq_webhook',
  name: 'Linq Webhook (All Events)',
  provider: 'linq',
  description: 'Trigger on any Linq webhook event (messages, reactions, chats, and more)',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_webhook',
    triggerOptions: linqTriggerOptions,
    setupInstructions: linqSetupInstructions('All Events'),
    extraFields: buildLinqExtraFields('linq_webhook'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
