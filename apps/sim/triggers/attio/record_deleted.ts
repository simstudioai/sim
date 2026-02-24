import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildRecordOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Record Deleted Trigger
 *
 * Triggers when a record is deleted in Attio.
 */
export const attioRecordDeletedTrigger: TriggerConfig = {
  id: 'attio_record_deleted',
  name: 'Attio Record Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a record is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_record_deleted',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('record.deleted'),
    extraFields: buildAttioExtraFields('attio_record_deleted'),
  }),

  outputs: buildRecordOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
