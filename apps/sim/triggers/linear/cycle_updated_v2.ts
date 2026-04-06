import { LinearIcon } from '@/components/icons'
import { buildCycleOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearCycleUpdatedV2Trigger: TriggerConfig = {
  id: 'linear_cycle_updated_v2',
  name: 'Linear Cycle Updated',
  provider: 'linear',
  description: 'Trigger workflow when a cycle is updated in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_cycle_updated_v2',
    eventType: 'Cycle (update)',
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
