import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpGoalOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupKeyResultUpdatedTrigger: TriggerConfig = {
  id: 'clickup_key_result_updated',
  name: 'ClickUp Key Result Updated',
  provider: 'clickup',
  description: 'Trigger workflow when a key result is updated in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_key_result_updated'),
  outputs: buildClickUpGoalOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
