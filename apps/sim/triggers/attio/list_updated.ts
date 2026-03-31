import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildListOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Updated Trigger
 *
 * Triggers when a list is updated in Attio.
 */
export const attioListUpdatedTrigger: TriggerConfig = {
  id: 'attio_list_updated',
  name: 'Attio List Updated',
  provider: 'attio',
  description: 'Trigger workflow when a list is updated in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_list_updated'),

  outputs: buildListOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
