import { LinearIcon } from '@/components/icons'
import { buildLabelOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearLabelCreatedV2Trigger: TriggerConfig = {
  id: 'linear_label_created_v2',
  name: 'Linear Label Created',
  provider: 'linear',
  description: 'Trigger workflow when a new label is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_label_created_v2',
    eventType: 'IssueLabel (create)',
  }),

  outputs: buildLabelOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'IssueLabel',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
