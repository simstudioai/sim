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
 * Linq Message Delivered Trigger
 * Fires when a sent message is confirmed delivered to the recipient.
 */
export const linqMessageDeliveredTrigger: TriggerConfig = {
  id: 'linq_message_delivered',
  name: 'Linq Message Delivered',
  provider: 'linq',
  description: 'Trigger workflow when a message is delivered',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_message_delivered',
    triggerOptions: linqTriggerOptions,
    setupInstructions: linqSetupInstructions('message.delivered'),
    extraFields: buildLinqExtraFields('linq_message_delivered'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
