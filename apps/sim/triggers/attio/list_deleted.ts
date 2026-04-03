import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildListOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Deleted Trigger
 *
 * Triggers when a list is deleted in Attio.
 */
export const attioListDeletedTrigger: TriggerConfig = {
  id: 'attio_list_deleted',
  name: 'Attio List Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a list is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_list_deleted'),

  outputs: buildListOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
