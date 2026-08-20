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
 * Trigger workflow when the first AI summary for a Granola note is generated
 */
export const granolaNoteGeneratedTrigger: TriggerConfig = {
  id: 'granola_note_generated',
  name: 'Granola Note Generated',
  provider: 'granola',
  description: 'Trigger workflow when the first AI summary for a Granola note is generated',
  version: '1.0.0',
  icon: GranolaIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'granola_note_generated',
    triggerOptions: granolaTriggerOptions,
    includeDropdown: true,
    setupInstructions: granolaSetupInstructions('note.generated'),
    extraFields: buildGranolaExtraFields('granola_note_generated'),
  }),

  outputs: buildGranolaOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
