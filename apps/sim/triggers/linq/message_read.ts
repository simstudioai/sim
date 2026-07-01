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
 * Linq Message Read Trigger
 * Fires when a recipient reads a sent message (1:1 iMessage/RCS).
 */
export const linqMessageReadTrigger: TriggerConfig = {
  id: 'linq_message_read',
  name: 'Linq Message Read',
  provider: 'linq',
  description: 'Trigger workflow when a message is read',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_message_read',
    triggerOptions: linqTriggerOptions,
    setupInstructions: linqSetupInstructions('message.read'),
    extraFields: buildLinqExtraFields('linq_message_read'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
