import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpGoalOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupGoalCreatedTrigger: TriggerConfig = {
  id: 'clickup_goal_created',
  name: 'ClickUp Goal Created',
  provider: 'clickup',
  description: 'Trigger workflow when a goal is created in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_goal_created'),
  outputs: buildClickUpGoalOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
