import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpGoalOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupKeyResultCreatedTrigger: TriggerConfig = {
  id: 'clickup_key_result_created',
  name: 'ClickUp Key Result Created',
  provider: 'clickup',
  description: 'Trigger workflow when a key result is created in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_key_result_created'),
  outputs: buildClickUpGoalOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
