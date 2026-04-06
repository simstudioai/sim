import { LinearIcon } from '@/components/icons'
import { buildLabelOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearLabelUpdatedV2Trigger: TriggerConfig = {
  id: 'linear_label_updated_v2',
  name: 'Linear Label Updated',
  provider: 'linear',
  description: 'Trigger workflow when a label is updated in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_label_updated_v2',
    eventType: 'IssueLabel (update)',
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
