import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildTaskOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Task Deleted Trigger
 *
 * Triggers when a task is deleted in Attio.
 */
export const attioTaskDeletedTrigger: TriggerConfig = {
  id: 'attio_task_deleted',
  name: 'Attio Task Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a task is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_task_deleted',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('task.deleted'),
    extraFields: buildAttioExtraFields('attio_task_deleted'),
  }),

  outputs: buildTaskOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
