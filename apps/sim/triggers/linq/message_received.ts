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
 * Linq Message Received Trigger
 * Fires when an inbound iMessage, SMS, or RCS message arrives.
 */
export const linqMessageReceivedTrigger: TriggerConfig = {
  id: 'linq_message_received',
  name: 'Linq Message Received',
  provider: 'linq',
  description: 'Trigger workflow when an inbound message is received',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_message_received',
    triggerOptions: linqTriggerOptions,
    includeDropdown: true,
    setupInstructions: linqSetupInstructions('message.received'),
    extraFields: buildLinqExtraFields('linq_message_received'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
