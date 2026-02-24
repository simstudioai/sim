import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildNoteOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Note Updated Trigger
 *
 * Triggers when a note is updated in Attio.
 */
export const attioNoteUpdatedTrigger: TriggerConfig = {
  id: 'attio_note_updated',
  name: 'Attio Note Updated',
  provider: 'attio',
  description: 'Trigger workflow when a note is updated in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_note_updated',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('note.updated'),
    extraFields: buildAttioExtraFields('attio_note_updated'),
  }),

  outputs: buildNoteOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
