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
 * Trigger workflow when a Granola note is shared with you, directly or via a folder
 */
export const granolaNoteAccessGrantedTrigger: TriggerConfig = {
  id: 'granola_note_access_granted',
  name: 'Granola Note Access Granted',
  provider: 'granola',
  description: 'Trigger workflow when a Granola note is shared with you, directly or via a folder',
  version: '1.0.0',
  icon: GranolaIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'granola_note_access_granted',
    triggerOptions: granolaTriggerOptions,
    setupInstructions: granolaSetupInstructions('note.access_granted'),
    extraFields: buildGranolaExtraFields('granola_note_access_granted'),
  }),

  outputs: buildGranolaOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
