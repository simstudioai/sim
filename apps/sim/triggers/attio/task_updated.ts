import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildTaskOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Task Updated Trigger
 *
 * Triggers when a task is updated in Attio.
 */
export const attioTaskUpdatedTrigger: TriggerConfig = {
  id: 'attio_task_updated',
  name: 'Attio Task Updated',
  provider: 'attio',
  description: 'Trigger workflow when a task is updated in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_task_updated'),

  outputs: buildTaskOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
