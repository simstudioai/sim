import { LinearIcon } from '@/components/icons'
import { buildLinearV2SubBlocks, buildProjectOutputs } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearProjectCreatedV2Trigger: TriggerConfig = {
  id: 'linear_project_created_v2',
  name: 'Linear Project Created',
  provider: 'linear',
  description: 'Trigger workflow when a new project is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_project_created_v2',
    eventType: 'Project (create)',
  }),

  outputs: buildProjectOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Project',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
