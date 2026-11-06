import { LinqIcon } from '@/components/icons'
import {
  buildLinqExtraFields,
  buildLinqOutputs,
  linqSetupInstructions,
  linqTriggerOptions,
} from '@/triggers/linq/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Linq Message Failed Trigger
 * Fires when a sent message fails to deliver.
 */
export const linqMessageFailedTrigger: TriggerConfig = {
  id: 'linq_message_failed',
  name: 'Linq Message Failed',
  provider: 'linq',
  description: 'Trigger workflow when a message fails to deliver',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_message_failed',
    triggerOptions: linqTriggerOptions,
    setupInstructions: linqSetupInstructions('message.failed'),
    extraFields: buildLinqExtraFields('linq_message_failed'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
