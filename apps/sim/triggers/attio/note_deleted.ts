import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildNoteOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Note Deleted Trigger
 *
 * Triggers when a note is deleted in Attio.
 */
export const attioNoteDeletedTrigger: TriggerConfig = {
  id: 'attio_note_deleted',
  name: 'Attio Note Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a note is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_note_deleted'),

  outputs: buildNoteOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
