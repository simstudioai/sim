import { LinearIcon } from '@/components/icons'
import { buildIssueOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearIssueUpdatedV2Trigger: TriggerConfig = {
  id: 'linear_issue_updated_v2',
  name: 'Linear Issue Updated',
  provider: 'linear',
  description: 'Trigger workflow when an issue is updated in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_issue_updated_v2',
    eventType: 'Issue (update)',
  }),

  outputs: buildIssueOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Issue',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
