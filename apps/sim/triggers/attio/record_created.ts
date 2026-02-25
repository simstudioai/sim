import { AttioIcon } from '@/components/icons'
import {
  attioTriggerOptions,
  buildAttioTriggerSubBlocks,
  buildRecordOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Record Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Triggers when a new record is created in Attio.
 */
export const attioRecordCreatedTrigger: TriggerConfig = {
  id: 'attio_record_created',
  name: 'Attio Record Created',
  provider: 'attio',
  description: 'Trigger workflow when a new record is created in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: attioTriggerOptions,
      value: () => 'attio_record_created',
      required: true,
    },
    ...buildAttioTriggerSubBlocks('attio_record_created'),
  ],

  outputs: buildRecordOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
