import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildListEntryUpdatedOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Entry Updated Trigger
 *
 * Triggers when a list entry is updated in Attio.
 */
export const attioListEntryUpdatedTrigger: TriggerConfig = {
  id: 'attio_list_entry_updated',
  name: 'Attio List Entry Updated',
  provider: 'attio',
  description: 'Trigger workflow when a list entry is updated in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_list_entry_updated'),

  outputs: buildListEntryUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
