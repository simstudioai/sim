import { LinearIcon } from '@/components/icons'
import { buildIssueOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Linear Issue Created Trigger (v2)
 *
 * Primary trigger - includes the dropdown for selecting trigger type.
 * Uses automatic webhook registration via the Linear GraphQL API.
 */
export const linearIssueCreatedV2Trigger: TriggerConfig = {
  id: 'linear_issue_created_v2',
  name: 'Linear Issue Created',
  provider: 'linear',
  description: 'Trigger workflow when a new issue is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_issue_created_v2',
    eventType: 'Issue (create)',
    includeDropdown: true,
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
