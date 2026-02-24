import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildListEntryOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Entry Deleted Trigger
 *
 * Triggers when a list entry is deleted in Attio.
 */
export const attioListEntryDeletedTrigger: TriggerConfig = {
  id: 'attio_list_entry_deleted',
  name: 'Attio List Entry Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a list entry is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_list_entry_deleted',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('list-entry.deleted'),
    extraFields: buildAttioExtraFields('attio_list_entry_deleted'),
  }),

  outputs: buildListEntryOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
