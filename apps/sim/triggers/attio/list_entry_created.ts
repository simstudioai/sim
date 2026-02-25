import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildListEntryOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Entry Created Trigger
 *
 * Triggers when a list entry is created in Attio.
 */
export const attioListEntryCreatedTrigger: TriggerConfig = {
  id: 'attio_list_entry_created',
  name: 'Attio List Entry Created',
  provider: 'attio',
  description: 'Trigger workflow when a new list entry is created in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_list_entry_created'),

  outputs: buildListEntryOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
