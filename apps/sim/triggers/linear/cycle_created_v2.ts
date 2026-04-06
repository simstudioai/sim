import { LinearIcon } from '@/components/icons'
import { buildCycleOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearCycleCreatedV2Trigger: TriggerConfig = {
  id: 'linear_cycle_created_v2',
  name: 'Linear Cycle Created',
  provider: 'linear',
  description: 'Trigger workflow when a new cycle is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_cycle_created_v2',
    eventType: 'Cycle (create)',
  }),

  outputs: buildCycleOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Cycle',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
