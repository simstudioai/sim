import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildRecordMergedEventOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Record Merged Trigger
 *
 * Triggers when two records are merged in Attio.
 */
export const attioRecordMergedTrigger: TriggerConfig = {
  id: 'attio_record_merged',
  name: 'Attio Record Merged',
  provider: 'attio',
  description: 'Trigger workflow when two records are merged in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_record_merged',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('record.merged'),
    extraFields: buildAttioExtraFields('attio_record_merged'),
  }),

  outputs: buildRecordMergedEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
