import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpTaskOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupTaskStatusUpdatedTrigger: TriggerConfig = {
  id: 'clickup_task_status_updated',
  name: 'ClickUp Task Status Updated',
  provider: 'clickup',
  description: 'Trigger workflow when the status of a task changes in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_task_status_updated'),
  outputs: buildClickUpTaskOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
