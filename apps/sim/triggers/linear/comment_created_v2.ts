import { LinearIcon } from '@/components/icons'
import { buildCommentOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearCommentCreatedV2Trigger: TriggerConfig = {
  id: 'linear_comment_created_v2',
  name: 'Linear Comment Created',
  provider: 'linear',
  description: 'Trigger workflow when a new comment is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_comment_created_v2',
    eventType: 'Comment (create)',
  }),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Comment',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
