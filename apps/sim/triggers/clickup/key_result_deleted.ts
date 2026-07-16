import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpGoalOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupKeyResultDeletedTrigger: TriggerConfig = {
  id: 'clickup_key_result_deleted',
  name: 'ClickUp Key Result Deleted',
  provider: 'clickup',
  description: 'Trigger workflow when a key result is deleted in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_key_result_deleted'),
  outputs: buildClickUpGoalOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
