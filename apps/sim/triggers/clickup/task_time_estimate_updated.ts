import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpTaskOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupTaskTimeEstimateUpdatedTrigger: TriggerConfig = {
  id: 'clickup_task_time_estimate_updated',
  name: 'ClickUp Task Time Estimate Updated',
  provider: 'clickup',
  description: 'Trigger workflow when the time estimate of a task changes in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_task_time_estimate_updated'),
  outputs: buildClickUpTaskOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
