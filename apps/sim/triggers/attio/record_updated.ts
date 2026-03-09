import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildRecordUpdatedOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Record Updated Trigger
 *
 * Triggers when a record is updated in Attio.
 */
export const attioRecordUpdatedTrigger: TriggerConfig = {
  id: 'attio_record_updated',
  name: 'Attio Record Updated',
  provider: 'attio',
  description: 'Trigger workflow when a record is updated in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_record_updated'),

  outputs: buildRecordUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
