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
 * Attio Task Created Trigger
 *
 * Triggers when a task is created in Attio.
 */
export const attioTaskCreatedTrigger: TriggerConfig = {
  id: 'attio_task_created',
  name: 'Attio Task Created',
  provider: 'attio',
  description: 'Trigger workflow when a new task is created in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_task_created',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('task.created'),
    extraFields: buildAttioExtraFields('attio_task_created'),
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
