import { LinearIcon } from '@/components/icons'
import { buildLinearV2SubBlocks, buildProjectUpdateOutputs } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearProjectUpdateCreatedV2Trigger: TriggerConfig = {
  id: 'linear_project_update_created_v2',
  name: 'Linear Project Update Created',
  provider: 'linear',
  description: 'Trigger workflow when a new project update is posted in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_project_update_created_v2',
    eventType: 'ProjectUpdate (create)',
  }),

  outputs: buildProjectUpdateOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'ProjectUpdate',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
