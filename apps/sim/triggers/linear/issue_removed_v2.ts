import { LinearIcon } from '@/components/icons'
import { buildIssueOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearIssueRemovedV2Trigger: TriggerConfig = {
  id: 'linear_issue_removed_v2',
  name: 'Linear Issue Removed',
  provider: 'linear',
  description: 'Trigger workflow when an issue is removed/deleted in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_issue_removed_v2',
    eventType: 'Issue (remove)',
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
