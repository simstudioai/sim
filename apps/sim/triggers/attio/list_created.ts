import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildListOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio List Created Trigger
 *
 * Triggers when a list is created in Attio.
 */
export const attioListCreatedTrigger: TriggerConfig = {
  id: 'attio_list_created',
  name: 'Attio List Created',
  provider: 'attio',
  description: 'Trigger workflow when a list is created in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_list_created'),

  outputs: buildListOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
