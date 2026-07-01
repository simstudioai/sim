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
 * Linq Reaction Added Trigger
 * Fires when a tapback or custom reaction is added to a message.
 */
export const linqReactionAddedTrigger: TriggerConfig = {
  id: 'linq_reaction_added',
  name: 'Linq Reaction Added',
  provider: 'linq',
  description: 'Trigger workflow when a reaction is added to a message',
  version: '1.0.0',
  icon: LinqIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'linq_reaction_added',
    triggerOptions: linqTriggerOptions,
    setupInstructions: linqSetupInstructions('reaction.added'),
    extraFields: buildLinqExtraFields('linq_reaction_added'),
  }),

  outputs: buildLinqOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
