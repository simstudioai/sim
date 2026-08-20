import { GranolaIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGranolaExtraFields,
  buildGranolaOutputs,
  granolaSetupInstructions,
  granolaTriggerOptions,
} from '@/triggers/granola/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Trigger workflow when a Granola note summary is edited or regenerated
 */
export const granolaNoteEditedTrigger: TriggerConfig = {
  id: 'granola_note_edited',
  name: 'Granola Note Edited',
  provider: 'granola',
  description: 'Trigger workflow when a Granola note summary is edited or regenerated',
  version: '1.0.0',
  icon: GranolaIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'granola_note_edited',
    triggerOptions: granolaTriggerOptions,
    setupInstructions: granolaSetupInstructions('note.edited'),
    extraFields: buildGranolaExtraFields('granola_note_edited'),
  }),

  outputs: buildGranolaOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
